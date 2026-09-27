package movement

import (
	"encoding/binary"
	"fmt"
	"math"

	worldgeom "opensro.online/server/internal/game/world"
	"opensro.online/server/internal/game/world/simulation"
)

// 998E76 loads DOF 0101 as navigation-host mode 8000. 998EA7 reads the
// first bounding box at header offset 7 into host+90..A4. 999272..9992E0
// sizes the message grid; 99A520 truncates (position-origin)/cell width.
// Host mode 8001 is a different producer, not dungeon region 8001.
type dungeonMessageGrid struct{ min, max [3]float64 }

func parseDungeonMessageGrid(raw []byte) (dungeonMessageGrid, error) {
	var g dungeonMessageGrid
	if len(raw) < 44 || string(raw[:12]) != "JMXVDOF 0101" {
		return g, fmt.Errorf("invalid DOF message-grid header")
	}
	offset := uint64(binary.LittleEndian.Uint32(raw[40:44]))
	if offset+24 > uint64(len(raw)) {
		return g, fmt.Errorf("truncated DOF message-grid bounds")
	}
	for i := 0; i < 6; i++ {
		v := float64(math.Float32frombits(binary.LittleEndian.Uint32(raw[int(offset)+i*4:])))
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return g, fmt.Errorf("nonfinite DOF message-grid bounds")
		}
		if i < 3 {
			g.min[i] = v
		} else {
			g.max[i-3] = v
		}
	}
	for i := range g.min {
		if g.max[i] < g.min[i] {
			return g, fmt.Errorf("inverted DOF message-grid bounds")
		}
	}
	return g, nil
}

// MessageBlockAt uses the same resident navigation owner as monster movement.
// Missing navigation is an unresolved query, never whole-dungeon activity.
func (v *WaterValidator) MessageBlockAt(p simulation.Spawn) (worldgeom.MessageBlock, bool) {
	if !worldgeom.IsDungeonRegion(p.RegionID) {
		return worldgeom.OutdoorMessageBlock(worldgeom.RegionXZ{RegionID: p.RegionID, X: p.X, Z: p.Z})
	}
	v.dungeonSpawnOnce.Do(func() { v.dungeonSpawnSurfaces = v.loadDungeonSpawnSurfaces() })
	s := v.dungeonSpawnSurfaces[p.RegionID]
	if s == nil {
		return worldgeom.MessageBlock{}, false
	}
	// A native query begins with an admitted nav-cell/resident pair. Reuse
	// nearest-plane admission; do not manufacture a bucket outside the mesh.
	if _, ok := s.heightAt(p.X, p.Y, p.Z); !ok {
		return worldgeom.MessageBlock{}, false
	}
	return s.messageGrid.at(p)
}

func (g dungeonMessageGrid) at(p simulation.Spawn) (worldgeom.MessageBlock, bool) {
	values := [3]float64{p.X, p.Y, p.Z}
	widths := [3]float64{320, 3200000, 320}
	var coords [3]int
	for i, v := range values {
		v = float64(float32(v))
		if math.IsNaN(v) || math.IsInf(v, 0) || v < g.min[i] || v > g.max[i] {
			return worldgeom.MessageBlock{}, false
		}
		coords[i] = int(float64(float32(v-g.min[i])) / widths[i])
	}
	return worldgeom.MessageBlock{Region: p.RegionID, X: coords[0], Y: coords[1], Z: coords[2]}, true
}
