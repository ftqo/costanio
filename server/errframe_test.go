package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The backend never sends prose for a client to render. A refusal is a stable
// code plus named parameters; the English beside it is a developer aid, in a
// field named `debug`. These tests enforce that.

// The encoded frame must expose exactly the contract's fields, with the prose
// under `debug`. A rename to `msg` (or any field a client might render) fails
// here.
func TestErrFrameWireShape(t *testing.T) {
	raw, err := json.Marshal(errFrame{
		T: "err", Ref: "c7", Code: "NO_RESOURCES",
		Params: map[string]any{"missing": map[string]int{"brick": 1}},
		Debug:  "You don't have the resources for that",
	})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"t": true, "ref": true, "code": true, "params": true, "debug": true}
	for k := range got {
		if !allowed[k] {
			t.Errorf("err frame carries unexpected field %q, want only {t, ref, code, params, debug}", k)
		}
	}
	if _, bad := got["msg"]; bad {
		t.Error("err frame carries `msg`; use `debug`")
	}
	if got["code"] != "NO_RESOURCES" {
		t.Errorf("code = %v, want NO_RESOURCES", got["code"])
	}
	// Omitted when absent: a refusal with no variable content sends no params,
	// and a refusal with no reference wording sends no debug.
	bare, _ := json.Marshal(errFrame{T: "err", Code: "MUST_ROLL"})
	if strings.Contains(string(bare), "params") || strings.Contains(string(bare), "debug") {
		t.Errorf("bare frame should omit empty params/debug: %s", bare)
	}
}

// codeSite is one (code, prose) pair found in the source.
type codeSite struct {
	file  string
	line  int
	code  string
	prose string
}

// scanCodeSites walks the Go sources that write client-bound errors (this
// package, and `auth/`, which has its own writeErr for the OAuth and session
// endpoints) and extracts the literal code and prose from each call. Calls are
// read to their closing paren, so calls wrapped over several lines are found.
func scanCodeSites(t *testing.T) []codeSite {
	t.Helper()
	// sendErr(ref, CODE, prose) / sendErrParams(ref, CODE, params, prose) /
	// writeErr(w, status, CODE, prose) / writeErrParams(w, status, CODE, params, prose)
	call := regexp.MustCompile(`\b(sendErr|sendErrParams|writeErr|writeErrParams)\(`)
	code := regexp.MustCompile(`"([A-Z][A-Z0-9_]*)"`)
	prose := regexp.MustCompile(`"([^"\\]*)"\s*,?\s*$`)

	var files []string
	for _, pat := range []string{"*.go", filepath.Join("..", "auth", "*.go")} {
		m, err := filepath.Glob(pat)
		if err != nil {
			t.Fatal(err)
		}
		files = append(files, m...)
	}
	var out []codeSite
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		src := string(raw)
		for _, loc := range call.FindAllStringIndex(src, -1) {
			if strings.HasSuffix(strings.TrimRight(src[:loc[0]], " \t"), "func") {
				continue // the definition, not a call
			}
			args, ok := callArgs(src, loc[1])
			if !ok {
				t.Fatalf("%s: unbalanced call at offset %d", f, loc[0])
			}
			args = strings.Join(strings.Fields(args), " ")
			c := code.FindStringSubmatch(args)
			if c == nil {
				continue // a computed code (errCode(err)); covered by the engine registry test
			}
			p := prose.FindStringSubmatch(args)
			text := ""
			if p != nil {
				text = p[1]
			}
			line := 1 + strings.Count(src[:loc[0]], "\n")
			out = append(out, codeSite{file: f, line: line, code: c[1], prose: text})
		}
	}
	if len(out) < 20 {
		t.Fatalf("scanned only %d error sites, want at least 20", len(out))
	}
	return out
}

// callArgs returns the text between the open paren that ends at `from` and its
// matching close, skipping over string, raw-string and rune literals so a paren
// inside prose does not end the call early.
func callArgs(src string, from int) (string, bool) {
	depth := 1
	for i := from; i < len(src); i++ {
		switch src[i] {
		case '"', '\'', '`':
			q := src[i]
			for i++; i < len(src) && src[i] != q; i++ {
				if src[i] == '\\' && q != '`' {
					i++
				}
			}
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return src[from:i], true
			}
		}
	}
	return "", false
}

// If two sites share a code but say different things, the client cannot render
// the right text from the code alone. Split the code instead.
func TestNoCodeCarriesTwoMeanings(t *testing.T) {
	// INTERNAL is one code for many causes: the player's recourse is always the
	// same (try again), and the details belong in `debug` and the logs.
	shared := map[string]bool{"INTERNAL": true}

	byCode := map[string][]codeSite{}
	for _, s := range scanCodeSites(t) {
		if shared[s.code] || s.prose == "" {
			continue
		}
		byCode[s.code] = append(byCode[s.code], s)
	}
	var offenders []string
	for c, sites := range byCode {
		distinct := map[string]bool{}
		for _, s := range sites {
			distinct[s.prose] = true
		}
		if len(distinct) > 1 {
			var where []string
			for _, s := range sites {
				where = append(where, s.file+":"+strconv.Itoa(s.line)+" "+strconv.Quote(s.prose))
			}
			sort.Strings(where)
			offenders = append(offenders, c+" means "+strconv.Itoa(len(distinct))+" different things:\n    "+strings.Join(where, "\n    "))
		}
	}
	sort.Strings(offenders)
	if len(offenders) > 0 {
		t.Errorf("codes used with more than one meaning:\n  %s", strings.Join(offenders, "\n  "))
	}
}

// Codes are persisted and keyed off by clients, so keep their shape predictable.
func TestTransportCodesAreWellFormed(t *testing.T) {
	shape := regexp.MustCompile(`^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`)
	for _, s := range scanCodeSites(t) {
		if !shape.MatchString(s.code) {
			t.Errorf("%s:%d: code %q is not SCREAMING_SNAKE_CASE", s.file, s.line, s.code)
		}
	}
}

// No em dashes in user-facing text, and the reference wording is held to the same
// bar as the copy it stands in for.
func TestReferenceWordingIsClean(t *testing.T) {
	for _, s := range scanCodeSites(t) {
		if strings.Contains(s.prose, "\u2014") {
			t.Errorf("%s:%d: no em dashes in user-facing text: %q", s.file, s.line, s.prose)
		}
	}
}

// The frontend owns the words, so every code this layer can emit needs copy
// there; otherwise the client shows a generic fallback. The engine's half of
// this check is in engine/ruletest.
func TestFrontendCopyCoversEveryTransportCode(t *testing.T) {
	path := filepath.Join("..", "frontend", "src", "lib", "errorCopy.ts")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("frontend copy table not readable (%v); skipping coverage check", err)
	}
	// Only the ERROR_COPY table counts, not other CONSTANT-keyed objects in the
	// file.
	table := string(src)
	if i := strings.Index(table, "export const ERROR_COPY"); i >= 0 {
		table = table[i:]
		if j := strings.Index(table, "\n};"); j >= 0 {
			table = table[:j]
		}
	} else {
		t.Fatalf("%s has no `export const ERROR_COPY`", path)
	}
	entry := regexp.MustCompile(`(?m)^ {2}([A-Z][A-Z0-9_]*):`)
	have := map[string]bool{}
	for _, m := range entry.FindAllStringSubmatch(table, -1) {
		have[m[1]] = true
	}
	if len(have) == 0 {
		t.Fatalf("parsed no entries out of %s", path)
	}
	missing := map[string]bool{}
	for _, s := range scanCodeSites(t) {
		if !have[s.code] {
			missing[s.code] = true
		}
	}
	// errCode's fallback is computed, not a literal, so the scan can't see it;
	// assert it explicitly.
	if !have[storageErrorCode] {
		missing[storageErrorCode] = true
	}
	if len(missing) > 0 {
		var list []string
		for c := range missing {
			list = append(list, c)
		}
		sort.Strings(list)
		t.Errorf("frontend %s has no copy for: %s", path, strings.Join(list, ", "))
	}
}
