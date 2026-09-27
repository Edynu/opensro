package enterworld

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadTextdataCatalogsFailsClosedBeforeNetworkAdmission(t *testing.T) {
	t.Parallel()

	_, err := LoadTextdataCatalogs(filepath.Join(t.TempDir(), "missing-textdata"))
	if err == nil {
		t.Fatal("missing authoritative textdata was accepted")
	}
	if !strings.Contains(err.Error(), "textdata readiness") {
		t.Fatalf("readiness error = %q, want an ownership-specific failure", err)
	}
}

func TestNewDevDepsRequiresTheLoadedTextdataOwner(t *testing.T) {
	t.Parallel()

	_, err := NewDevDeps(DevPaths{}, nil)
	if err == nil || !strings.Contains(err.Error(), "loaded authoritative textdata") {
		t.Fatalf("NewDevDeps nil textdata error = %v", err)
	}
}
