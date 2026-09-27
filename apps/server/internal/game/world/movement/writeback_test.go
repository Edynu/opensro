package movement

import (
	"bytes"
	"encoding/json"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

// TestHandleMoveWriteBackPreservesWorldPassthroughFields pins SCOUT-B
// FINDING 500: an accepted 0x7738 write-back must refresh ONLY the goal
// plane it owns (spawn / movementMode / spawnSet) and carry every other
// persisted world field through, like the Node move path's {...world}
// spread. The old replace-struct write-back rebuilt character.World from
// scratch and wiped dungeonMinimap, movementSourceSeeded, updatedAt and the
// raw moveSegment echo on every accepted move.
func TestHandleMoveWriteBackPreservesWorldPassthroughFields(t *testing.T) {
	character := testCharacter()

	start := simulation.EuropeStartProfile()
	regionID := int64(start.RegionID)
	x, y, z := start.X, start.Y, start.Z
	angle := int64(0)
	mode := int64(simulation.RunMode)
	floorIndex := int64(2)
	seededSegment := json.RawMessage(`{"opaque":"survives"}`)
	character.World = &enterworld.CharacterWorld{
		Spawn:                &enterworld.WorldSpawn{RegionID: &regionID, X: &x, Y: &y, Z: &z, Angle: &angle},
		MovementMode:         &mode,
		SpawnSet:             true,
		DungeonFloorIndex:    &floorIndex,
		MovementSourceSeeded: true,
		UpdatedAt:            "2026-07-25T10:00:00.000Z",
		MoveSegment:          seededSegment,
	}
	before := character.World
	rt := testRuntime(character)

	outcome := rt.HandleMove("0", character, encodeMoveBody(1, start.RegionID, int16(start.X)+100, int16(start.Y), int16(start.Z)))
	if outcome.Refusal != nil {
		t.Fatalf("move refused: %v", outcome.Refusal)
	}

	world := character.World
	if world == nil || world.Spawn == nil || world.Spawn.X == nil || world.MovementMode == nil {
		t.Fatalf("write-back left a hole: %+v", world)
	}
	// The owned goal-plane trio still refreshes.
	if *world.Spawn.X != start.X+100 || !world.SpawnSet {
		t.Errorf("goal plane: x = %v spawnSet = %v, want %v/true", *world.Spawn.X, world.SpawnSet, start.X+100)
	}

	// The passthrough fields survive the accepted move (FINDING 500).
	if world.DungeonFloorIndex == nil {
		t.Fatal("dungeonFloorIndex wiped by the move write-back (FINDING 500 regressed)")
	}
	if *world.DungeonFloorIndex != 2 {
		t.Errorf("dungeonFloorIndex mangled: %+v", world.DungeonFloorIndex)
	}
	if !world.MovementSourceSeeded {
		t.Error("movementSourceSeeded dropped by the move write-back")
	}
	if world.UpdatedAt != "2026-07-25T10:00:00.000Z" {
		t.Errorf("updatedAt dropped: %q", world.UpdatedAt)
	}
	if !bytes.Equal(world.MoveSegment, seededSegment) {
		t.Errorf("moveSegment passthrough dropped: %s", world.MoveSegment)
	}

	// Publication stays copy-then-swap: an alias taken before the move (the
	// character snapshot shallow-copy aliases the World pointer) keeps the
	// OLD settled spawn; the record is not mutated underneath the alias.
	if before.Spawn == nil || before.Spawn.X == nil {
		t.Error("pre-move world alias lost its spawn record")
	} else if *before.Spawn.X != start.X {
		t.Errorf("pre-move world record mutated in place: x = %v, want %v", *before.Spawn.X, start.X)
	}

	// A second accepted move chains the preserve (each write-back copies
	// forward the record the previous one produced).
	second := rt.HandleMove("0", character, encodeMoveBody(1, start.RegionID, int16(start.X), int16(start.Y), int16(start.Z)+150))
	if second.Refusal != nil {
		t.Fatalf("second move refused: %v", second.Refusal)
	}
	world = character.World
	if world.DungeonFloorIndex == nil || *world.DungeonFloorIndex != 2 {
		t.Errorf("dungeonFloorIndex dropped on the second write-back: %+v", world.DungeonFloorIndex)
	}
	if world.UpdatedAt != "2026-07-25T10:00:00.000Z" || !bytes.Equal(world.MoveSegment, seededSegment) {
		t.Errorf("passthroughs dropped on the second write-back: updatedAt=%q moveSegment=%s", world.UpdatedAt, world.MoveSegment)
	}
}
