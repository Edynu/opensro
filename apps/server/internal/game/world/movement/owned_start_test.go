package movement

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOwnedStartNativePrefix(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "native-owned-start-reference.json"))
	if err != nil {
		t.Fatal(err)
	}
	var reference struct {
		BinarySha256 string
		Rows         []struct{ Point, Result [2]float64 }
	}
	if err = json.Unmarshal(raw, &reference); err != nil {
		t.Fatal(err)
	}
	if reference.BinarySha256 != "375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a" {
		t.Fatal("Unpinned native reference")
	}
	mesh := &objectNavMesh{vertices: []float32{0, 0, 0, 0, 0, 100, 100, 0, 0}, cellA: []uint16{0}, cellB: []uint16{1}, cellC: []uint16{2}}
	for _, r := range reference.Rows {
		x, z := ownedCellStart(mesh, 0, r.Point[0], r.Point[1])
		if [2]float64{x, z} != r.Result {
			t.Fatalf("point %v got %v want %v", r.Point, [2]float64{x, z}, r.Result)
		}
	}
	// Retention must use the corrected chord, including a start whose requested
	// direction is away from the cell. The abandoned leading-sliver shortcut
	// lost the owner immediately in that case.
	path := traceObjectCells(&objectDeckStand{mesh: mesh, cellIndex: 0}, -.01, 20, -10, 20)
	if len(path.spans) == 0 || path.spans[0].to <= 0 || path.spans[0].to >= 1 {
		t.Fatalf("missing exit after corrected start: %+v", path.spans)
	}
}
