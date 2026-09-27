package movement

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMovementGridDimensionsAreBoundedBeforeMultiplication(t *testing.T) {
	var bundle regionBundle
	bundle.Navmesh.TilesPerAxis = json.Number("4294967296")
	bundle.Navmesh.TileSize = json.Number("20")
	bundle.Navmesh.HeightMapAxisVertices = json.Number("4294967296")

	if grids := buildBlockedGrids(&bundle); len(grids) != 0 {
		t.Fatalf("oversized blocked grid produced %d entries", len(grids))
	}
	if grids := buildHeightGrids(&bundle); len(grids) != 0 {
		t.Fatalf("oversized height grid produced %d entries", len(grids))
	}
}

func TestMovementAssetReaderEnforcesRootAndPreallocationLimit(t *testing.T) {
	root := t.TempDir()
	read := boundedMovementAssetReader(root)

	inside := filepath.Join(root, "region.json")
	if err := os.WriteFile(inside, []byte(`{"ok":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if payload, err := read(inside); err != nil || string(payload) != `{"ok":true}` {
		t.Fatalf("inside asset = %q, %v", payload, err)
	}

	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := read(outside); err == nil {
		t.Fatal("asset reader accepted a file outside its root")
	}

	oversized := filepath.Join(root, "oversized.json")
	file, err := os.Create(oversized)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxMovementAssetBytes + 1); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := read(oversized); err == nil {
		t.Fatal("asset reader accepted an oversized file")
	}
}
