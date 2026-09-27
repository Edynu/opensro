package movement

import (
	"encoding/base64"
	"encoding/binary"
	"testing"
)

func TestCompactWalkabilityMatchesBothSourcePlanes(t *testing.T) {
	var bundle regionBundle
	bundle.Navmesh.TilesPerAxis = "9"
	bundle.Navmesh.TileSize = "20"
	r := navmeshRegion{}
	r.Cells.Count = "3"
	blocked, ids := make([]byte, 81), make([]byte, 81*4)
	for i := range blocked {
		blocked[i] = byte(i % 3)
		id := uint32(i % 5)
		if i == 63 || i == 64 || i == 80 {
			blocked[i] = 0
			id = 2
		}
		if i == 0 {
			id = ^uint32(0)
		}
		binary.LittleEndian.PutUint32(ids[i*4:], id)
	}
	r.BlockedTiles = base64.StdEncoding.EncodeToString(blocked)
	r.TileCellIds = base64.StdEncoding.EncodeToString(ids)
	bundle.Navmesh.Regions = []navmeshRegion{r}
	g := buildBlockedGrids(&bundle)[0]
	if g == nil || len(g.walkable) != 2 {
		t.Fatal("missing compact plane")
	}
	for i := range blocked {
		want := blocked[i] == 0 && binary.LittleEndian.Uint32(ids[i*4:]) < 3
		if g.tileWalkable(i) != want {
			t.Fatalf("tile %d differs", i)
		}
	}
}
