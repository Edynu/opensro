package movement

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestVertexDirectionNativeReference(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "native-vertex-direction-reference.json"))
	if err != nil {
		t.Fatal(err)
	}
	var ref struct {
		BinarySha256 string
		Table        []float64
		Rows         []struct {
			Source, Hit, Result [2]float64
			Directions          [2]byte
		}
	}
	if err = json.Unmarshal(raw, &ref); err != nil {
		t.Fatal(err)
	}
	if ref.BinarySha256 != "375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a" || len(ref.Table) != 512 {
		t.Fatal("Unpinned native reference")
	}
	for i := 0; i < 256; i++ {
		x, z := vertexDirection(byte(i))
		if math.Float32bits(float32(x)) != math.Float32bits(float32(ref.Table[i*2])) || math.Float32bits(float32(z)) != math.Float32bits(float32(ref.Table[i*2+1])) {
			t.Fatalf("direction %d: %v,%v", i, x, z)
		}
	}
	for _, r := range ref.Rows {
		x, z := outsideEdgeStart(r.Source[0], r.Source[1], r.Hit[0], r.Hit[1], 0, 0, 0, 100, r.Directions[0], r.Directions[1])
		if [2]float64{x, z} != r.Result {
			t.Fatalf("source %v: got %v want %v", r.Source, [2]float64{x, z}, r.Result)
		}
	}
	mesh := &objectNavMesh{vertices: []float32{0, 0, 0, 0, 0, 100}, vertexDirections: []byte{0, 64}}
	edges := &objectNavEdges{vertA: []uint16{0}, vertB: []uint16{1}, srcCell: []uint16{0}, dstCell: []uint16{65535}, flags: []byte{1}}
	p := nativeObjectContact(mesh, edges, 0, false, -10, 50, 7, 10, 50)
	if !p.valid || !p.outside || p.y != 7 || p.x != ref.Rows[2].Result[0] || p.z != ref.Rows[2].Result[1] {
		t.Fatalf("outside contact lost native response: %+v", p)
	}
}
