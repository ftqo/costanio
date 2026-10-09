package ruletest

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/explorers"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"

	// Blank-imported for its init: the game layer registers refusals of its own
	// (a bot playing your seat, a claim that needs bots) in the same registry.
	_ "github.com/ftqo/costan.io/game"
)

// The backend sends a stable code for every refusal and the client owns the
// words, so every refusal needs a code; one without reaches clients as a generic
// STORAGE_ERROR. Adding a sentinel and registering only its message compiles and
// passes every rules test, so the two registries are checked against each other.
//
// Lives in ruletest because it needs every module registered, which engine's own
// tests cannot import.
func TestErrorRegistryIsOneToOne(t *testing.T) {
	codes := engine.RegisteredErrorCodes()
	msgs := engine.RegisteredErrorMessages()

	byErrCode := map[error]string{}
	for _, c := range codes {
		if prev, dup := byErrCode[c.Err]; dup {
			t.Errorf("sentinel %q has two codes: %q and %q", c.Err, prev, c.Code)
		}
		byErrCode[c.Err] = c.Code
	}
	byErrMsg := map[error]string{}
	for _, m := range msgs {
		if prev, dup := byErrMsg[m.Err]; dup {
			t.Errorf("sentinel %q has two messages: %q and %q", m.Err, prev, m.Message)
		}
		byErrMsg[m.Err] = m.Message
	}

	for err, code := range byErrCode {
		if _, ok := byErrMsg[err]; !ok {
			t.Errorf("code %q (%v) has no registered message", code, err)
		}
	}
	for err, msg := range byErrMsg {
		if _, ok := byErrCode[err]; !ok {
			t.Errorf("message %q (%v) has no registered code", msg, err)
		}
	}
}

// Codes are persisted and keyed off by clients, so two refusals must never share
// one, and the shape must stay predictable.
func TestErrorCodesAreUniqueAndWellFormed(t *testing.T) {
	shape := regexp.MustCompile(`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`)
	seen := map[string]error{}
	for _, c := range engine.RegisteredErrorCodes() {
		if !shape.MatchString(c.Code) {
			t.Errorf("code %q is not SCREAMING_SNAKE_CASE", c.Code)
		}
		if prev, dup := seen[c.Code]; dup {
			t.Errorf("code %q is registered for two sentinels: %v and %v", c.Code, prev, c.Err)
		}
		seen[c.Code] = c.Err
	}
	// The transport's own fallback. A registered refusal must never collide with
	// it, or a specific reason would be indistinguishable from "no idea".
	if err, ok := seen["STORAGE_ERROR"]; ok {
		t.Errorf("STORAGE_ERROR is the transport fallback, not a registrable code (%v)", err)
	}
}

// Reference wording is a developer aid, but a sloppy one becomes a client's
// copy by accident, so hold it to the same bar the frontend copy is held to.
func TestErrorMessagesAreWellFormed(t *testing.T) {
	for _, m := range engine.RegisteredErrorMessages() {
		if m.Message == "" {
			t.Errorf("%v has an empty message", m.Err)
			continue
		}
		if strings.Contains(m.Message, "\u2014") {
			t.Errorf("%v: no em dashes in user-facing text: %q", m.Err, m.Message)
		}
		if c := m.Message[0]; c < 'A' || c > 'Z' {
			t.Errorf("%v: message must start capitalized: %q", m.Err, m.Message)
		}
		// Internal jargon leaking through: module prefixes belong in the Go
		// error text, never in anything shaped like presentation.
		for _, prefix := range []string{"cak:", "islands:", "engine:", "tab:", "raiders:"} {
			if strings.Contains(m.Message, prefix) {
				t.Errorf("%v: message carries internal jargon %q: %q", m.Err, prefix, m.Message)
			}
		}
	}
}

// The frontend owns the words, so every code the backend can emit needs an entry
// in the frontend's copy table. Without this, adding a code on the Go side ships
// a refusal the client renders as a raw token.
func TestFrontendCopyCoversEveryCode(t *testing.T) {
	path := filepath.Join("..", "..", "frontend", "src", "lib", "errorCopy.ts")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("frontend copy table not readable: %v", err)
	}
	entry := regexp.MustCompile(`(?m)^\s{2}([A-Z][A-Z0-9_]*):`)
	have := map[string]bool{}
	for _, m := range entry.FindAllStringSubmatch(string(src), -1) {
		have[m[1]] = true
	}
	if len(have) == 0 {
		t.Fatalf("parsed no entries out of %s", path)
	}
	var missing []string
	for _, c := range engine.RegisteredErrorCodes() {
		if !have[c.Code] {
			missing = append(missing, c.Code)
		}
		delete(have, c.Code)
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("frontend %s has no copy for: %s", path, strings.Join(missing, ", "))
	}
	// Transport-level codes the frontend also renders are not in the engine
	// registry, so an unmatched frontend entry is expected and not an error.
}

// Parameters are named and typed so a client can place them in its own grammar.
// A sentence or an arbitrary struct as a parameter would put prose back on the
// wire.
func TestRefusalParamsAreWireSafe(t *testing.T) {
	cases := []struct {
		name   string
		params engine.Params
		want   bool
	}{
		{"scalars", engine.Params{"needed": 2, "piece": "road", "free": true}, true},
		{"resource map", engine.Params{"missing": map[string]int{"brick": 1}}, true},
		{"string list", engine.Params{"cards": []string{"knight"}}, true},
		{"struct value", engine.Params{"cost": struct{ A int }{1}}, false},
		{"float", engine.Params{"ratio": 1.5}, false},
	}
	for _, tc := range cases {
		if got := engine.ValidParams(tc.params); got != tc.want {
			t.Errorf("%s: ValidParams = %v, want %v", tc.name, got, tc.want)
		}
	}

	// A parameterized refusal still resolves to its sentinel, so every rule and
	// test that only cares which rule refused is unaffected.
	wrapped := engine.WithParams(engine.ErrNoPieces, engine.Params{"piece": "road"})
	if engine.ErrorCode(wrapped) != "NO_PIECES" {
		t.Errorf("parameterized refusal lost its code: %q", engine.ErrorCode(wrapped))
	}
	if p := engine.ErrorParams(wrapped); p["piece"] != "road" {
		t.Errorf("parameterized refusal lost its params: %v", p)
	}
	if engine.ErrorParams(engine.ErrNoPieces) != nil {
		t.Error("a bare sentinel should carry no params")
	}
}

// Map lint issues follow the same contract as refusals: a stable code, optional
// named parameters, and reference wording the client must not render. Their
// codes are lowercase snake_case and live in their own frontend table, so they
// get their own coverage check.
func TestFrontendCopyCoversEveryMapIssueCode(t *testing.T) {
	copyPath := filepath.Join("..", "..", "frontend", "src", "lib", "errorCopy.ts")
	src, err := os.ReadFile(copyPath)
	if err != nil {
		t.Skipf("frontend copy table not readable: %v", err)
	}
	have := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s{2}([a-z][a-z0-9_]*):`).FindAllStringSubmatch(string(src), -1) {
		have[m[1]] = true
	}
	if len(have) == 0 {
		t.Fatalf("parsed no lint entries out of %s", copyPath)
	}

	// Producing every code would mean a hand-built board per issue, so read
	// the literals from the source.
	var missing []string
	for _, f := range []string{
		filepath.Join("..", "board", "lint.go"),
		filepath.Join("..", "module.go"),
	} {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		lit := regexp.MustCompile(`Code:\s*"([a-z][a-z0-9_]*)"|Issue\{sev(?:Error|Warning), "([a-z][a-z0-9_]*)"`)
		for _, m := range lit.FindAllStringSubmatch(string(body), -1) {
			code := m[1]
			if code == "" {
				code = m[2]
			}
			if !have[code] {
				missing = append(missing, f+": "+code)
			}
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("frontend %s has no copy for these map lint codes: %s", copyPath, strings.Join(missing, ", "))
	}
}

// The 1:1 test above cannot see a sentinel added to neither registry, which then
// reaches the player as the generic "That move isn't allowed". So check the
// declarations too.
func TestEveryRulesSentinelIsRegistered(t *testing.T) {
	sources := []string{
		filepath.Join("..", "decide.go"),
		filepath.Join("..", "islands", "decide.go"),
		filepath.Join("..", "knights", "decide.go"),
		filepath.Join("..", "knights", "progress_play.go"),
	}
	decl := regexp.MustCompile(`(?m)^\s*(Err[A-Za-z0-9]+)\s*=\s*errors\.New\(`)
	registered := regexp.MustCompile(`RegisterErrorCode\((?:engine\.)?(Err[A-Za-z0-9]+)`)

	have := map[string]bool{}
	for _, f := range []string{
		filepath.Join("..", "errcode.go"),
		filepath.Join("..", "islands", "usererr.go"),
		filepath.Join("..", "knights", "usererr.go"),
	} {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range registered.FindAllStringSubmatch(string(body), -1) {
			have[m[1]] = true
		}
	}

	var missing []string
	for _, f := range sources {
		body, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		found := decl.FindAllStringSubmatch(string(body), -1)
		if len(found) == 0 {
			t.Fatalf("parsed no sentinels out of %s", f)
		}
		for _, m := range found {
			if !have[m[1]] {
				missing = append(missing, f+": "+m[1])
			}
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Errorf("rules errors with no registered code:\n  %s", strings.Join(missing, "\n  "))
	}
}
