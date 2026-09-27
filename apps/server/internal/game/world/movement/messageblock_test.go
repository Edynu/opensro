package movement

import (
	"encoding/binary"
	"math"
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

func TestDungeonMessageGridUsesAuthoredOriginAndHeightSlabs(t *testing.T) {
	raw := make([]byte, 128)
	copy(raw, "JMXVDOF 0101")
	binary.LittleEndian.PutUint32(raw[40:], 64)
	for i, v := range []float32{-500, -4000000, 125, 1100, 4000000, 1725} {
		binary.LittleEndian.PutUint32(raw[64+i*4:], math.Float32bits(v))
	}
	g, err := parseDungeonMessageGrid(raw)
	if err != nil {
		t.Fatal(err)
	}
	p := simulation.Spawn{RegionID: 0x8001, X: -180, Y: -800000, Z: 445}
	b, ok := g.at(p)
	if !ok || b.X != 1 || b.Y != 1 || b.Z != 1 {
		t.Fatalf("wrong grid projection: %+v %v", b, ok)
	}
	p.X = -180.01
	b, ok = g.at(p)
	if !ok || b.X != 0 {
		t.Fatalf("wrong seam side: %+v", b)
	}
	p.X = -501
	if _, ok = g.at(p); ok {
		t.Fatal("outside bounds admitted")
	}
}
