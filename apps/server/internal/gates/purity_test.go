// purity_test.go enforces the property gates.go documents: this package
// imports nothing from this module, so `go test ./internal/gates/` compiles and the
// gates keep reporting while the rest of the tree is mid-refactor and does
// not build. If an internal import sneaks in, the gates become hostage to
// module compilation again - and nothing except this test would notice
// until the next breakage silently swallowed a drift signal.
package gates

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// modulePathFromGoMod reads the module identity from go.mod instead of
// hardcoding it, so a module rename cannot quietly disarm this guard.
func modulePathFromGoMod(t *testing.T, root string) string {
	t.Helper()
	src, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("gates purity: read go.mod: %v", err)
	}
	for _, line := range strings.Split(string(src), "\n") {
		line = strings.TrimSpace(line)
		if rest, ok := strings.CutPrefix(line, "module "); ok {
			return strings.TrimSpace(rest)
		}
	}
	t.Fatalf("gates purity: no module directive in go.mod")
	return ""
}

// TestGatesPackageImportsNothingInternal parses every .go file in this
// directory (test files included) and fails if any import path belongs to
// this module.
func TestGatesPackageImportsNothingInternal(t *testing.T) {
	root, rootErr := ModuleRoot()
	if rootErr != nil {
		t.Fatalf("gates purity: locate module root: %v", rootErr)
	}
	modulePath := modulePathFromGoMod(t, root)

	entries, err := os.ReadDir(filepath.Join(root, "internal", "gates"))
	if err != nil {
		t.Fatalf("gates purity: read gates directory: %v", err)
	}
	fset := token.NewFileSet()
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
			continue
		}
		path := filepath.Join(root, "internal", "gates", entry.Name())
		src, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("gates purity: read %s: %v", path, readErr)
		}
		file, parseErr := parser.ParseFile(fset, path, src, parser.ImportsOnly)
		if parseErr != nil {
			// Unlike the module-wide gates, THIS package being unparseable
			// is our business: the gates themselves must always compile.
			t.Errorf("gates purity: %s does not parse: %v", entry.Name(), parseErr)
			continue
		}
		for _, imp := range file.Imports {
			importPath := strings.Trim(imp.Path.Value, `"`)
			if importPath == modulePath || strings.HasPrefix(importPath, modulePath+"/") {
				t.Errorf("gates purity: %s imports %s - the gates package must import nothing from this module, or `go test ./internal/gates/` stops compiling whenever the module is broken (which is exactly when the gates matter)", entry.Name(), importPath)
			}
		}
	}
}
