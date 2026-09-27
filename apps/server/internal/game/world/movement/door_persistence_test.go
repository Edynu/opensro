package movement

// Store-backed continuity test for the movement lane's mutation site
// (ADR-1 S1): every ACCEPTED 0x7738 commits the goal plane through the
// door; a watchdog reboot resumes the character AT the goal with the
// movement mode and every world passthrough field intact.

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"opensro.online/server/internal/data/store"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

const doorTestDivision = "global-official"

// doorSkillSeeder is this suite's stand-in for enterworld.DefaultSkillSeeder
// (the store's unconditional creation-seed invariant refuses an unseeded
// CreateCharacter): the same racial id sets, without a textdata dependency.
func doorSkillSeeder(raceKey string, learned []uint32) ([]uint32, error) {
	ids := []uint32{1, 7127, 7128, 7129, 7909, 7910, 8454, 9069, 9606, 9970}
	if raceKey == enterworld.RaceKeyChina {
		ids = []uint32{1, 2, 40, 70}
	}
	have := make(map[uint32]bool, len(learned))
	for _, id := range learned {
		have[id] = true
	}
	missing := make([]uint32, 0, len(ids))
	for _, id := range ids {
		if !have[id] {
			missing = append(missing, id)
		}
	}
	return missing, nil
}

// doorMoveBody encodes a mode-1 ground click (u8 hasDestination, u16le
// region, u16le x/y/z), the shape the hub race gate in bootstrap uses.
func doorMoveBody(regionID uint16, x, y, z int16) []byte {
	out := make([]byte, 9)
	out[0] = 1
	binary.LittleEndian.PutUint16(out[1:3], regionID)
	binary.LittleEndian.PutUint16(out[3:5], uint16(x))
	binary.LittleEndian.PutUint16(out[5:7], uint16(y))
	binary.LittleEndian.PutUint16(out[7:9], uint16(z))
	return out
}

// TestMoveContinuityAcrossRestart: an accepted move's goal survives a
// fresh-store hydration (post-mutation, never pre), the live plane reseeds
// AT the goal (moveSegment is runtime-only by design in both stacks), and
// the write-back's copy-forward keeps every passthrough world field.
func TestMoveContinuityAcrossRestart(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")
	authority, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(authority.Close)

	// A character carrying the FULL passthrough surface: sticky dungeon
	// minimap, movementSourceSeeded, updatedAt, raw moveSegment echo.
	floorIndex := int64(3)
	walkMode := int64(simulation.WalkMode)
	seededSegment := json.RawMessage(`{"opaque":"survives"}`)
	seed := &enterworld.Character{
		Name:          "asd2",
		ModelCodename: "CHAR_CH_MAN_ADVENTURER",
		World: &enterworld.CharacterWorld{
			MovementMode:         &walkMode,
			DungeonFloorIndex:    &floorIndex,
			MovementSourceSeeded: true,
			UpdatedAt:            "2026-07-25T10:00:00.000Z",
			MoveSegment:          seededSegment,
		},
	}
	if err := authority.CreateCharacter(doorTestDivision, "test-account", seed); err != nil {
		t.Fatalf("CreateCharacter: %v", err)
	}
	character := authority.Characters().CharactersForDivision(doorTestDivision)[0]

	deps := &enterworld.Deps{Characters: authority.Characters()}
	deps.MutateCharacter = func(c *enterworld.Character, label string, fn func()) {
		// The server wiring's scoped door (ADR-2).
		authority.MutateCharacter(c, label, fn)
	}
	rt := NewRuntime(deps, simulation.NewWorldStore())
	rt.Now = func() time.Time { return time.UnixMilli(1_000_000) }

	start := simulation.SeedWorldState(character).Spawn
	goalX := int16(start.X) + 80
	outcome := rt.HandleMove(doorTestDivision, character, doorMoveBody(start.RegionID, goalX, int16(start.Y), int16(start.Z)))
	if outcome.Refusal != nil {
		t.Fatalf("move refused: %+v", outcome.Refusal)
	}

	// The watchdog reboot: the first instance dies (a real reboot never
	// has two live stores - the single-writer guard refuses that), then
	// a FRESH store hydrates from the directory alone.
	authority.Close()
	rebooted, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open after reboot: %v", err)
	}
	t.Cleanup(rebooted.Close)
	restored := rebooted.Characters().CharactersForDivision(doorTestDivision)[0]
	world := restored.World
	if world == nil || world.Spawn == nil || world.Spawn.X == nil {
		t.Fatalf("world after reboot = %+v", world)
	}
	if *world.Spawn.X != float64(goalX) {
		t.Fatalf("goal X after reboot = %v, want %v (kill mid-move resumes at the goal)", *world.Spawn.X, goalX)
	}
	if !world.SpawnSet {
		t.Fatal("spawnSet lost across reboot")
	}
	// Run/walk mode: the accepted move wrote the world's CURRENT mode
	// (walk, from the seeded record) back through the door.
	if world.MovementMode == nil || *world.MovementMode != walkMode {
		t.Fatalf("movementMode after reboot = %v, want the preserved walk mode %d", world.MovementMode, walkMode)
	}

	// Copy-forward passthrough (FINDING 500 mirror, now THROUGH the store):
	if world.DungeonFloorIndex == nil || *world.DungeonFloorIndex != 3 {
		t.Fatalf("dungeonFloorIndex mangled across the store round-trip: %+v", world.DungeonFloorIndex)
	}
	if !world.MovementSourceSeeded {
		t.Fatal("movementSourceSeeded dropped across the store round-trip")
	}
	if world.UpdatedAt != "2026-07-25T10:00:00.000Z" {
		t.Fatalf("updatedAt dropped: %q", world.UpdatedAt)
	}
	// VALUE-exact, not byte-exact: the store's MarshalIndent re-indents
	// embedded raw messages (whitespace only; P2's audit canonicalizes the
	// same way before hashing).
	var wantSegment, gotSegment bytes.Buffer
	if err := json.Compact(&wantSegment, seededSegment); err != nil {
		t.Fatal(err)
	}
	if len(world.MoveSegment) == 0 {
		t.Fatal("moveSegment echo dropped entirely")
	}
	if err := json.Compact(&gotSegment, world.MoveSegment); err != nil {
		t.Fatalf("moveSegment after reboot is not valid JSON: %v", err)
	}
	if gotSegment.String() != wantSegment.String() {
		t.Fatalf("moveSegment value changed: %s, want %s", gotSegment.String(), wantSegment.String())
	}

	// The live plane reseeds AT the goal: no in-flight segment survives.
	reseeded := simulation.SeedWorldState(restored)
	if reseeded.Spawn.X != float64(goalX) {
		t.Fatalf("reseeded live X = %v, want the goal %v", reseeded.Spawn.X, goalX)
	}
	if reseeded.MoveSegment != nil {
		t.Fatal("an in-flight segment resurrected across the reboot (moveSegment is runtime-only)")
	}
	if reseeded.MovementMode != simulation.WalkMode {
		t.Fatalf("reseeded movement mode = %d, want walk", reseeded.MovementMode)
	}
}
