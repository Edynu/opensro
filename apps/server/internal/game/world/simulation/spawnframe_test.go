package simulation

import (
	"math"
	"testing"
)

// The live incident this fold exists for: character asd2 persisted the goal
// in its enter-world frame (region 0x5E9E) with locals almost three sectors
// out of range. The same world point in the canonical frame is region 0x60A0
// local (~1842.79, ~1279.23) - map X4984 Y895, where the player actually
// stood while the client loaded terrain around 0x5E9E and left them floating
// in an unloaded void.
var asd2StaleSpawn = Spawn{
	RegionID: 0x5E9E,
	X:        5682.786447160981,
	Y:        817.0863865487756,
	Z:        5119.23114342619,
	Angle:    24576,
}

func TestNormalizeSpawnFrameInRangeIsIdentity(t *testing.T) {
	in := Spawn{RegionID: 0x6B4F, X: 1205, Y: 80, Z: 396, Angle: 12345}
	if got := NormalizeSpawnFrame(in); got != in {
		t.Fatalf("in-range spawn must pass through untouched: got %+v want %+v", got, in)
	}
	// Region-edge zero stays put (the fold gate is [0, NativeRegionSize)).
	edge := Spawn{RegionID: 0x6B4F, X: 0, Y: 0, Z: 0, Angle: 0}
	if got := NormalizeSpawnFrame(edge); got != edge {
		t.Fatalf("zero-edge spawn must pass through untouched: got %+v", got)
	}
}

func TestNormalizeSpawnFrameFoldsMultiSectorOverflow(t *testing.T) {
	got := NormalizeSpawnFrame(asd2StaleSpawn)

	if got.RegionID != 0x60A0 {
		t.Fatalf("stale asd2 frame must fold to region 0x60A0, got 0x%04X", got.RegionID)
	}
	if got.X < 0 || got.X >= NativeRegionSize || got.Z < 0 || got.Z >= NativeRegionSize {
		t.Fatalf("folded locals must be in [0, %v): got x=%v z=%v", NativeRegionSize, got.X, got.Z)
	}
	if math.Abs(got.X-1842.786447160981) > 1e-9 || math.Abs(got.Z-1279.23114342619) > 1e-9 {
		t.Fatalf("folded locals drifted: got x=%v z=%v", got.X, got.Z)
	}
	if got.Y != asd2StaleSpawn.Y || got.Angle != asd2StaleSpawn.Angle {
		t.Fatalf("fold must not touch y/angle: got y=%v angle=%d", got.Y, got.Angle)
	}

	// The fold must be a pure reframe: re-expressing the folded point in the
	// original frame reproduces the original coordinates exactly.
	back := RegionLocalToSeedLocal(asd2StaleSpawn.RegionID, got.RegionID,
		Vec3{X: got.X, Y: got.Y, Z: got.Z}, NativeRegionSize)
	if back.X != asd2StaleSpawn.X || back.Z != asd2StaleSpawn.Z {
		t.Fatalf("fold is not a pure reframe: round-trip x=%v z=%v", back.X, back.Z)
	}
}

func TestNormalizeSpawnFrameFoldsNegativeOverflow(t *testing.T) {
	in := Spawn{RegionID: 0x60A0, X: -100, Y: 10, Z: 500, Angle: 1}
	got := NormalizeSpawnFrame(in)
	if got.RegionID != 0x609F {
		t.Fatalf("negative x must borrow one sector west: got 0x%04X", got.RegionID)
	}
	if got.X != NativeRegionSize-100 || got.Z != 500 {
		t.Fatalf("negative fold locals wrong: got x=%v z=%v", got.X, got.Z)
	}
}

func TestNormalizeSpawnFrameLeavesDungeonPlaneAlone(t *testing.T) {
	// Dungeon locals are not bounded by the outdoor 1920 grid; folding them
	// would corrupt legal positions.
	in := Spawn{RegionID: 0x8001, X: 5000, Y: -30, Z: 7000, Angle: 7}
	if got := NormalizeSpawnFrame(in); got != in {
		t.Fatalf("dungeon spawn must pass through untouched: got %+v", got)
	}
}

func TestApplyMoveCommitsCanonicalGoalButEchoesRequestFrame(t *testing.T) {
	world := &WorldState{
		Spawn:        Spawn{RegionID: 0x5E9E, X: 1000, Y: 80, Z: 1000, Angle: 0},
		MovementMode: RunMode,
	}
	// A destination sent in the stale enter-world frame, two sectors out.
	request := MovementRequest{
		Mode:     MovementAckDestinationMode,
		RegionID: 0x5E9E,
		X:        4000,
		Y:        80,
		Z:        4100,
	}
	result := ApplyMove(world, 100001, request, RunMode, 1784000000000)

	if world.Spawn.RegionID != 0x60A0 {
		t.Fatalf("goal plane must commit canonical region 0x60A0, got 0x%04X", world.Spawn.RegionID)
	}
	if world.Spawn.X != 4000-2*NativeRegionSize || world.Spawn.Z != 4100-2*NativeRegionSize {
		t.Fatalf("goal plane locals must fold: got x=%v z=%v", world.Spawn.X, world.Spawn.Z)
	}

	// The 0xB738 echo keeps the request's own frame (wire parity: the client
	// interprets the echo in the frame it sent).
	payload := result.AckPayload
	echoRegion := uint16(payload[5]) | uint16(payload[6])<<8
	echoX := uint16(payload[7]) | uint16(payload[8])<<8
	if echoRegion != request.RegionID || echoX != 4000 {
		t.Fatalf("ack echo must keep the request frame: region 0x%04X x=%d", echoRegion, echoX)
	}

	// Travel timing is frame-agnostic, so the folded goal must not change the
	// segment's arrival math versus the same move expressed canonically.
	liveBefore := Spawn{RegionID: 0x5E9E, X: 1000, Y: 80, Z: 1000, Angle: 0}
	canonicalGoal := Spawn{RegionID: 0x60A0, X: 4000 - 2*NativeRegionSize, Y: 80, Z: 4100 - 2*NativeRegionSize}
	if want := WorldDistance2D(liveBefore, canonicalGoal); math.Abs(WorldDistance2D(liveBefore, world.Spawn)-want) > 1e-9 {
		t.Fatalf("folded goal changed travel distance")
	}
	if result.Segment == nil {
		t.Fatalf("expected a live segment for a multi-sector hop")
	}
}
