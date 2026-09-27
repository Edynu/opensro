package action

import (
	"bytes"
	"encoding/json"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

// TestWriteBackWorldPreservesPassthroughFields is the item-lane mirror of
// the movement FINDING 500 pin (mailbox 534): the write-back after a drop /
// pickup / gold op owns ONLY spawn/movementMode/spawnSet; dungeonMinimap,
// movementSourceSeeded, updatedAt and the raw moveSegment echo must copy
// through, like the Node handlers' {...world} spread.
func TestWriteBackWorldPreservesPassthroughFields(t *testing.T) {
	start := simulation.EuropeStartProfile()
	regionID := int64(start.RegionID)
	x, y, z := start.X, start.Y, start.Z
	angle := int64(0)
	mode := int64(simulation.RunMode)
	floorIndex := int64(3)
	seededSegment := json.RawMessage(`{"opaque":"survives"}`)
	character := &enterworld.Character{
		ID:            9,
		Name:          "Asd",
		ModelCodename: "CHAR_EU_MAN1",
		World: &enterworld.CharacterWorld{
			Spawn:                &enterworld.WorldSpawn{RegionID: &regionID, X: &x, Y: &y, Z: &z, Angle: &angle},
			MovementMode:         &mode,
			SpawnSet:             true,
			DungeonFloorIndex:    &floorIndex,
			MovementSourceSeeded: true,
			UpdatedAt:            "2026-07-25T10:00:00.000Z",
			MoveSegment:          seededSegment,
		},
	}
	before := character.World

	state := simulation.DefaultWorldState(start)
	state.Spawn.X = start.X + 40
	state.SpawnSet = true

	writeBackWorld(character, state)

	world := character.World
	if world == nil || world.Spawn == nil || world.Spawn.X == nil || world.MovementMode == nil {
		t.Fatalf("write-back left a hole: %+v", world)
	}
	if *world.Spawn.X != start.X+40 || !world.SpawnSet {
		t.Errorf("owned goal plane not refreshed: x = %v spawnSet = %v, want %v/true", *world.Spawn.X, world.SpawnSet, start.X+40)
	}
	if world.DungeonFloorIndex == nil {
		t.Fatal("dungeonFloorIndex wiped by the item-lane write-back (mirror of FINDING 500)")
	}
	if *world.DungeonFloorIndex != 3 {
		t.Errorf("dungeonFloorIndex mangled: %+v", world.DungeonFloorIndex)
	}
	if !world.MovementSourceSeeded {
		t.Error("movementSourceSeeded dropped by the item-lane write-back")
	}
	if world.UpdatedAt != "2026-07-25T10:00:00.000Z" {
		t.Errorf("updatedAt dropped: %q", world.UpdatedAt)
	}
	if !bytes.Equal(world.MoveSegment, seededSegment) {
		t.Errorf("moveSegment passthrough dropped: %s", world.MoveSegment)
	}

	// Copy-then-swap publication: the pre-write alias keeps the old settled
	// spawn (the character snapshot's shallow copy aliases this pointer).
	if before.Spawn == nil || before.Spawn.X == nil {
		t.Error("pre-write world alias lost its spawn record")
	} else if *before.Spawn.X != start.X {
		t.Errorf("pre-write world record mutated in place: x = %v, want %v", *before.Spawn.X, start.X)
	}
}
