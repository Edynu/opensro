package simulation

import (
	"math"
	"testing"

	"opensro.online/server/internal/game/item/wire"
)

func petClearPath(_, to Spawn) (Spawn, *MoveError) { return to, nil }

func TestPetFollowUsesAuthoredSpeedAndSettlesOnce(t *testing.T) {
	spawn := Spawn{RegionID: 0x62a8, X: 100, Z: 100}
	p := NewPetFollower(55, spawn)
	owner := spawn
	owner.X += 200
	frames := p.Advance(owner, 80, 1000, petClearPath)
	if len(frames) != 2 || frames[1].Opcode != OpMovementAck {
		t.Fatal(frames)
	}
	if got := p.Position(1500); got.X != 140 {
		t.Fatalf("authored speed ignored: %+v", got)
	}
	if got := p.Advance(owner, 80, 1100, petClearPath); len(got) != 0 {
		t.Fatal("unchanged goal resubmitted", got)
	}
	if got := p.Advance(owner, 80, 1100, petClearPath); len(got) != 0 {
		t.Fatal("same tick advanced twice")
	}
	if got := p.Advance(owner, 80, 4000, petClearPath); len(got) != 1 || got[0].Opcode != wire.OpObjectSourceCorrection {
		t.Fatal("arrival", got)
	}
	for now := int64(4100); now < 10000; now += 100 {
		if got := p.Advance(owner, 80, now, petClearPath); len(got) != 0 {
			t.Fatal("idle traffic", got)
		}
	}
}

func TestPetFollowCollisionAndMissingGeometryCannotTeleport(t *testing.T) {
	spawn := Spawn{RegionID: 0x62a8, X: 100, Z: 100}
	owner := spawn
	owner.X = 300
	p := NewPetFollower(55, spawn)
	if f := p.Advance(owner, 80, 1000, nil); len(f) != 0 || p.Position(2000) != spawn {
		t.Fatal("missing geometry admitted motion")
	}
	p.Advance(owner, 80, 2000, petClearPath)
	before := p.Position(2500)
	owner.Z += 100
	blocked := func(from, to Spawn) (Spawn, *MoveError) { return from, &MoveError{Reason: "blocked"} }
	if f := p.Advance(owner, 80, 2500, blocked); len(f) != 1 || p.Position(8000) != before {
		t.Fatal("collision did not stop at live position", f, p.Position(8000), before)
	}
}

func TestPetFollowCrossRegionAndPlaneIsolation(t *testing.T) {
	spawn := Spawn{RegionID: 0x62a8, X: 1900, Z: 100}
	p := NewPetFollower(55, spawn)
	owner := Spawn{RegionID: 0x62a9, X: 180, Z: 100}
	if f := p.Advance(owner, 80, 1000, petClearPath); len(f) != 2 {
		t.Fatal("outdoor boundary rejected", f)
	}
	if d := WorldDistance2D(spawn, p.Position(1500)); math.Abs(d-40) > 0.001 {
		t.Fatal("sector jump", d)
	}
	owner.RegionID = 0x8001
	before := p.Position(1500)
	p.Advance(owner, 80, 1500, petClearPath)
	if p.Position(5000) != before {
		t.Fatal("pet crossed an unrelated world")
	}
}

func TestPetFollowRoundedCollisionEndpointIsRevalidated(t *testing.T) {
	spawn := Spawn{RegionID: 0x62a8, X: 100, Z: 100}
	owner := spawn
	owner.X = 300
	p := NewPetFollower(55, spawn)
	clip := func(from, to Spawn) (Spawn, *MoveError) { to.X = 150.6; return to, nil }
	if f := p.Advance(owner, 80, 1000, clip); len(f) != 0 || p.Position(5000) != spawn {
		t.Fatal("rounded endpoint escaped clipping", f)
	}
}
