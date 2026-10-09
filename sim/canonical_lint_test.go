package sim

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// rulesetLiteral matches a string that is clearly a ruleset: "base", optionally
// followed by module names. Narrow so it doesn't match unrelated strings that
// start with "base".
var rulesetLiteral = regexp.MustCompile(`^base(\+[a-z]+)*$`)

// TestEveryRulesetLiteralIsCanonical: a hand-ordered ruleset string in a sim
// test exercises a module order no lobby produces. Module order matters
// (DefaultConfig is first-writer-wins, and SetupBoard hooks run in
// ruleset-string order), and every creation path runs the string through
// engine.CanonicalRuleset, so only canonical spellings match real games.
//
// Literals passed to canonical(), engine.CanonicalRuleset() or noncanonical()
// are exempt: the first two normalise fixture spellings, and noncanonical()
// asserts its argument is not canonical, so the exemption can't hide a mistake.
//
// Scope is sim/ only: engine/ruletest asserts that persisted non-canonical
// strings still resolve in their own order, which replay determinism requires.
func TestEveryRulesetLiteralIsCanonical(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no Go files found")
	}
	fset := token.NewFileSet()
	checked := 0
	for _, name := range files {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		f, err := parser.ParseFile(fset, name, src, 0)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		// Positions of literals that sit inside a canonicalising call, at any
		// depth (canonical() takes a composite literal of them).
		exempt := map[token.Pos]bool{}
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || !isCanonicaliser(call.Fun) {
				return true
			}
			for _, arg := range call.Args {
				ast.Inspect(arg, func(m ast.Node) bool {
					if lit, ok := m.(*ast.BasicLit); ok {
						exempt[lit.Pos()] = true
					}
					return true
				})
			}
			return true
		})

		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING || exempt[lit.Pos()] {
				return true
			}
			s, err := strconv.Unquote(lit.Value)
			if err != nil || !rulesetLiteral.MatchString(s) {
				return true
			}
			checked++
			if got := engine.CanonicalRuleset(s); got != s {
				t.Errorf("%s: ruleset literal %q is not canonical, want %q; wrap it in canonical(...), "+
					"engine.CanonicalRuleset(%q) or noncanonical(t, ...)",
					fset.Position(lit.Pos()), s, got, s)
			}
			return true
		})
	}
	// Fail if the scan stops matching anything (regexp, exemption walk or
	// glob gone inert).
	if checked < 20 {
		t.Fatalf("only %d ruleset literals found in sim/", checked)
	}
}

// isCanonicaliser reports whether a call expression is one whose string
// arguments are exempt: canonical(...) and engine.CanonicalRuleset(...), whose
// arguments are fixture spellings being normalised, and noncanonical(...) (see
// bookkeeping_test.go), whose hand-ordered argument is the input under test and
// is asserted non-canonical at runtime.
func isCanonicaliser(fun ast.Expr) bool {
	switch f := fun.(type) {
	case *ast.Ident:
		return f.Name == "canonical" || f.Name == "noncanonical"
	case *ast.SelectorExpr:
		pkg, ok := f.X.(*ast.Ident)
		return ok && pkg.Name == "engine" && f.Sel.Name == "CanonicalRuleset"
	}
	return false
}
