package simulation

import "testing"

func deckOwner(cell int32) NavOwner {
	return NavOwner{Kind: NavOwnerObject, Object: NavObjectCell{Surface: 0x5B87, Object: 3, Mesh: 0, Cell: cell}}
}

// The retained owner is valid only for the exact position it was resolved
// for: any writer that relocates without walking falls back to the native
// teleport rule instead of carrying a stale cell.
func TestGoalOwnerSelfInvalidatesOnRelocation(t *testing.T) {
	w := WorldState{Spawn: Spawn{RegionID: 0x5B87, X: 1122, Y: 243.99, Z: 1330}}
	w.SetGoalOwner(deckOwner(7))
	if w.GoalOwner() != deckOwner(7) {
		t.Fatal("owner not retained")
	}
	w.Spawn.Angle = 1234
	if w.GoalOwner() != deckOwner(7) {
		t.Fatal("facing is not part of a nav position")
	}
	w.Spawn.X = 1500 // e.g. a warp writing Spawn directly
	if w.GoalOwner().Resolved() {
		t.Fatal("a relocated position must not keep the old cell")
	}
}

// A walked segment answers the owner at the live fraction, and settling or
// turning mid-walk keeps the owner under the walker.
func TestLiveOwnerFollowsWalkedSpansAndSettles(t *testing.T) {
	w := WorldState{Spawn: Spawn{RegionID: 0x5B87, X: 1122, Y: 243.99, Z: 1330}}
	from := w.Spawn
	w.Spawn = Spawn{RegionID: 0x5B87, X: 1122, Y: 243.99, Z: 1130}
	w.MoveSegment = &MoveSegment{From: from, StartedAtMs: 1000, ArrivesAtMs: 2000}
	w.CommitWalk([]NavOwnerSpan{{From: 0, To: .5, Owner: deckOwner(1)}, {From: .5, To: 1, Owner: deckOwner(2)}}, deckOwner(2))

	if got := w.LiveOwnerAt(1250); got != deckOwner(1) {
		t.Fatalf("owner at t=.25 = %+v", got)
	}
	if got := w.LiveOwnerAt(1750); got != deckOwner(2) {
		t.Fatalf("owner at t=.75 = %+v", got)
	}
	if got := w.LiveOwnerAt(3000); got != deckOwner(2) {
		t.Fatalf("settled owner = %+v", got)
	}

	stopped := w
	stopped.SettleLive(1250)
	if stopped.MoveSegment != nil || stopped.GoalOwner() != deckOwner(1) {
		t.Fatalf("settle lost the live owner: %+v", stopped.GoalOwner())
	}

	turned := w
	result := ApplyMove(&turned, 1, MovementRequest{Mode: MovementAckAngularMode, HeadingWord: 99}, RunMode, 1750)
	if result.Segment != nil || turned.GoalOwner() != deckOwner(2) || turned.Spawn.Angle != 99 {
		t.Fatalf("turn lost the owner: %+v %+v", turned.GoalOwner(), turned.Spawn)
	}

	// A new ground move without CommitWalk has no spans: unresolved, never
	// the previous segment's owners.
	moved := w
	ApplyMove(&moved, 1, MovementRequest{Mode: MovementAckDestinationMode, RegionID: 0x5B87, X: 1200, Y: 244, Z: 1200}, RunMode, 1250)
	if moved.LiveOwnerAt(1300).Resolved() || moved.GoalOwner().Resolved() {
		t.Fatal("an uncommitted walk must not inherit stale ownership")
	}
}
