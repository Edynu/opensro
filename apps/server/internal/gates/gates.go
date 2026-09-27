// Package gates holds this module's repo-hygiene gates: tests that enforce
// standing invariants (formatting, forbidden imports) rather than testing
// behavior.
//
// The package deliberately imports nothing from this module. This lets
// `go test ./internal/gates/` report repository-policy failures even while another
// package is mid-refactor and does not compile. purity_test.go enforces that
// independence.
package gates

import (
	"errors"
	"os"
	"path/filepath"
)

// ModuleRoot walks up from the working directory to the directory holding
// go.mod. The gates anchor their file walks there so they cover the whole
// module no matter which directory `go test` runs them from.
func ModuleRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no go.mod found walking up from the working directory")
		}
		dir = parent
	}
}
