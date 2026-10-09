package store

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// TestNoReadHandleInsideTransaction enforces the rule the two-handle split rests
// on (see the Store doc comment): a method that opens a write transaction must
// not also read through rdb, which would silently see pre-transaction state.
// There is no allowlist: reads inside a transaction go through the *sql.Tx.
func TestNoReadHandleInsideTransaction(t *testing.T) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", nil, 0)
	if err != nil {
		t.Fatalf("parse store package: %v", err)
	}
	checked := 0
	for _, pkg := range pkgs {
		for name, file := range pkg.Files {
			if strings.HasSuffix(name, "_test.go") {
				continue
			}
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Body == nil {
					continue
				}
				checked++
				var opensTx, readsRDB bool
				ast.Inspect(fn.Body, func(n ast.Node) bool {
					sel, ok := n.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					inner, ok := sel.X.(*ast.SelectorExpr)
					if !ok {
						return true
					}
					recv, ok := inner.X.(*ast.Ident)
					if !ok || recv.Name != "s" {
						return true
					}
					switch {
					case inner.Sel.Name == "db" && sel.Sel.Name == "Begin":
						opensTx = true
					case inner.Sel.Name == "rdb":
						readsRDB = true
					}
					return true
				})
				if opensTx && readsRDB {
					t.Errorf("%s opens a transaction and also reads through rdb; read through the *sql.Tx",
						fn.Name.Name)
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("parsed no function declarations")
	}
}
