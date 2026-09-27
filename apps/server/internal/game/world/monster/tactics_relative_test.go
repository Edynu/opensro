package monster

import (
	"math"
	"testing"
)

func TestNativeTacticsRelativePlanes(t *testing.T) {
	for _, tc := range []struct {
		name     string
		from, to Pose
		x, z     float32
	}{
		{"outdoor seam", Pose{RegionID: 0x6262, X: 1910, Z: 1900}, Pose{RegionID: 0x6363, X: 10, Z: 20}, 20, 40},
		{"indoor distinct words", Pose{RegionID: 0x8001, X: 10, Y: -1000, Z: 20}, Pose{RegionID: 0x8002, X: 30, Y: 1000, Z: 50}, 20, 30},
	} {
		t.Run(tc.name, func(t *testing.T) {
			x, y, z := NativeTacticsRelative(tc.from, tc.to)
			if x != tc.x || y != 0 || z != tc.z {
				t.Fatalf("got %g,%g,%g", x, y, z)
			}
		})
	}
	for _, regions := range [][2]uint16{{0x6262, 0x8001}, {0x8001, 0x6262}} {
		x, y, z := NativeTacticsRelative(Pose{RegionID: regions[0]}, Pose{RegionID: regions[1]})
		for _, component := range []float32{x, y, z} {
			if math.Float32bits(component) != 0x7e967699 {
				t.Fatal("cross-plane sentinel was replaced with sector arithmetic")
			}
		}
	}
}
