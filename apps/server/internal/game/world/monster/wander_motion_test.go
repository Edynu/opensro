package monster

import (
	"math"
	"testing"
)

func TestNativeWanderDistanceAndFacingBranches(t *testing.T) {
	for _, sign := range []uint32{0, 1} {
		for _, turn := range []uint32{0, 90} {
			words := []uint32{sign, 39, turn, sign}
			i := 0
			m := NativeWanderMotion(0, func() uint32 { w := words[i]; i++; return w })
			wantDistance, wantAngle := 46.0, -float64(turn+45)/2
			if sign == 1 {
				wantDistance = 124
				wantAngle = -wantAngle
			}
			if i != 4 || m.Distance != wantDistance {
				t.Fatalf("draws=%d motion=%+v", i, m)
			}
			if angle := math.Atan2(m.Z, m.X) * 180 / math.Pi; math.Abs(angle-wantAngle) > 0.0001 {
				t.Fatalf("angle=%v want %v", angle, wantAngle)
			}
			if math.Abs(math.Hypot(m.X, m.Z)-1) > 1e-6 {
				t.Fatalf("not normalized: %+v", m)
			}
			for _, result := range []uint32{0, 2, NavResultClipped, NavResultBlocked, NavResultBlocked | NavResultClipped} {
				adjusted := m.AfterProbe(result)
				if result&(NavResultBlocked|NavResultClipped) == 0 {
					if adjusted != m {
						t.Fatal("clear probe changed direction")
					}
				} else if adjusted.X != -m.X || adjusted.Z != -m.Z || adjusted.Distance != m.Distance {
					t.Fatal("blocked probe must reverse, not shorten")
				}
			}
		}
	}
}

func TestNativeWanderRotatesWithActor(t *testing.T) {
	base := NativeWanderMotion(0, func() uint32 { return 0 })
	rotated := NativeWanderMotion(16384, func() uint32 { return 0 })
	if math.Abs(rotated.X+base.Z) > 0.0001 || math.Abs(rotated.Z-base.X) > 0.0001 {
		t.Fatalf("facing lost: %+v %+v", base, rotated)
	}
}
