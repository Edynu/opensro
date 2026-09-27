package config

import (
	"fmt"
	"os"
	"path/filepath"
)

// FindModuleRoot locates this Go module from the working directory or the
// running executable. Source-checkout tools use it to anchor safe defaults;
// deployed processes should use explicit environment configuration.
func FindModuleRoot() (string, error) {
	starts := make([]string, 0, 2)
	if cwd, err := os.Getwd(); err == nil {
		starts = append(starts, cwd)
	}
	if executable, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(executable))
	}
	for _, start := range starts {
		for dir := filepath.Clean(start); ; dir = filepath.Dir(dir) {
			if info, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil &&
				!info.IsDir() {
				return dir, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
		}
	}
	return "", fmt.Errorf("could not locate the server module root")
}
