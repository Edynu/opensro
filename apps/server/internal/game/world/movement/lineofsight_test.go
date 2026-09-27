/*
===========================================================================

lineofsight_test.go - tests for Runtime.LineOfSight

===========================================================================
*/

package movement

import (
	"testing"

	"opensro.online/server/internal/game/world/simulation"
)

// The Jangan veranda rail blocks a walk, so it blocks a skill; a chord
// that stops short of the rail is clear.
func TestLineOfSightRealRail(t *testing.T) {
	validator := realAuthorityValidator(t)
	rt := &Runtime{ClientClip: &ClientClip{Mode: ClipApply, Validator: validator}}

	from := simulation.Spawn{RegionID: 0x61A7, X: 623, Y: 3.04, Z: 1271}
	behindRail := simulation.Spawn{RegionID: 0x61A7, X: 683, Y: 3.04, Z: 1271}
	beforeRail := simulation.Spawn{RegionID: 0x61A7, X: 640, Y: 3.04, Z: 1271}

	if rt.LineOfSight(from, simulation.NavOwner{}, behindRail) {
		t.Fatal("line through the east rail reported clear")
	}
	if !rt.LineOfSight(from, simulation.NavOwner{}, beforeRail) {
		t.Fatal("line short of the rail reported blocked")
	}
}

// Only an applied clip is authority, and a line test moves nobody, so it
// must not count as an inspected walk.
func TestLineOfSightPostureAndStatistics(t *testing.T) {
	from := spawnAt(0x6B4F, 30, 110)
	to := spawnAt(0x6B4F, 190, 110)
	blocked := &fakeClipValidator{report: ClipReport{Outcome: ClipBlocked}}

	applied := &ClientClip{Mode: ClipApply, Validator: blocked}
	if (&Runtime{ClientClip: applied}).LineOfSight(from, simulation.NavOwner{}, to) {
		t.Fatal("applied clip: blocked line reported clear")
	}
	if stats := applied.Stats(); stats.Inspected != 0 {
		t.Fatalf("line test counted as a walk: %+v", stats)
	}

	observing := &ClientClip{Mode: ClipObserve, Validator: blocked}
	if !(&Runtime{ClientClip: observing}).LineOfSight(from, simulation.NavOwner{}, to) {
		t.Fatal("observing clip refused a line")
	}
	if !(&Runtime{}).LineOfSight(from, simulation.NavOwner{}, to) {
		t.Fatal("no clip refused a line")
	}
}

// Outdoor and dungeon positions never see each other.
func TestLineOfSightCrossPlane(t *testing.T) {
	clear := &fakeClipValidator{report: ClipReport{Outcome: ClipArrived}}
	rt := &Runtime{ClientClip: &ClientClip{Mode: ClipApply, Validator: clear}}
	outdoor := spawnAt(0x6B4F, 30, 110)
	dungeon := simulation.Spawn{RegionID: 0x8000 | 0x6B4F, X: 30, Z: 110}
	if rt.LineOfSight(outdoor, simulation.NavOwner{}, dungeon) {
		t.Fatal("line across the dungeon boundary reported clear")
	}
	if clear.calls != 0 {
		t.Fatalf("cross-plane line reached the validator %d times", clear.calls)
	}
}
