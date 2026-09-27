package movement

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

func TestCosMoveUsesCanonicalMovementAndRejectsForeignOwner(t *testing.T) {
	c := testCharacter()
	rt := testRuntime(c)
	start := simulation.EuropeStartProfile()
	c.ActiveCOS = &enterworld.CharacterCOS{GID: 123, Mounted: true, Summoned: true, CurrentHP: 100}
	p := encodeMoveBody(1, start.RegionID, int16(start.X)+20, int16(start.Y), int16(start.Z))
	if frames := rt.HandleCOSMove("0", c, 124, p); len(frames) != 0 {
		t.Fatal("foreign owner moved")
	}
	if frames := rt.HandleCOSMove("0", c, 123, p); len(frames) != 1 {
		t.Fatalf("owned move: %v", frames)
	}
	c.ActiveCOS.Mounted = false
	if frames := rt.HandleCOSMove("0", c, 123, p); len(frames) != 0 {
		t.Fatal("unmounted COS moved player")
	}
	c.ActiveCOS.Mounted = true
	c.ActiveCOS.CurrentHP = 0
	if frames := rt.HandleCOSMove("0", c, 123, p); len(frames) != 0 {
		t.Fatal("dead COS moved")
	}
}
