package movement

import (
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

// The live portal probe approaches through the actual entrance corridor;
// selecting a distant gate must never waive the neighbouring stair/rail collision.
func TestPortalEntranceWalkableCorridor(t *testing.T) {
	v := realAuthorityValidator(t)
	for _, x := range []float64{950, 1000, 1100} {
		a := simulation.Spawn{RegionID: 25256, X: x, Y: 20, Z: 450}
		b := a
		b.Z = 0
		r := v.ClipMovementPath(a, b)
		want := ClipArrived
		if x == 1100 {
			want = ClipBlocked
		}
		if r.Outcome != want {
			t.Fatalf("entrance x=%g: %+v", x, r)
		}
	}
}
