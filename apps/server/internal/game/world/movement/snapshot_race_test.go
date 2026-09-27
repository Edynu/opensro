package movement

// Race test for the tick snapshot path (FIX: the 100ms tick's
// WorldSnapshot/peerAppearance read the live *Character's mutable
// fields - MissionInventory, GuildID, ModelRef, BodyShapeByte, World -
// with no store door, while action/guild/progression write them inside
// MutateCharacter). Run with -race: before the read-door fix this test
// reports a data race between the store door's writes and the snapshot's
// unlocked reads; after it, the snapshot copies every field under
// Deps.Read and the detector stays quiet.

import (
	"path/filepath"
	"sync"
	"testing"

	"opensro.online/server/internal/data/store"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
	"opensro.online/server/internal/transport/worldsession"
)

// raceEquipSet builds one alternating equipment-band inventory (slots
// 0..12 are the band peerAppearance walks; distinct lengths force the
// slice header itself to change, the mid-swap tear the fix closes).
func raceEquipSet(variant int) []enterworld.InventoryRow {
	if variant%2 == 0 {
		return []enterworld.InventoryRow{
			{Slot: 0, RefObjID: 3632, TypeFlags: 0x1845, Plus: 3},
			{Slot: 1, RefObjID: 3653, TypeFlags: 0x1985, Plus: 1},
		}
	}
	return []enterworld.InventoryRow{
		{Slot: 0, RefObjID: 3640, TypeFlags: 0x1845, Plus: 5},
		{Slot: 4, RefObjID: 3670, TypeFlags: 0x1a05, Plus: 0},
		{Slot: 5, RefObjID: 3690, TypeFlags: 0x1a45, Plus: 2},
	}
}

// TestWorldSnapshotDoesNotRaceTheCommitDoor drives the exact production
// interleaving the tick creates: goroutine A commits inventory swaps and
// guild-FK toggles through the store's mutation door while goroutine B
// takes tick snapshots through the session's SnapshotProvider - the same
// live *Character record on both sides (ADR-1 pointer identity).
func TestWorldSnapshotDoesNotRaceTheCommitDoor(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")
	authority, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(authority.Close)

	modelRef := int64(1907)
	bodyShape := int64(1)
	seed := &enterworld.Character{
		Name:             "racer",
		ModelCodename:    "CHAR_EU_MAN",
		ModelRef:         &modelRef,
		BodyShapeByte:    &bodyShape,
		MissionInventory: raceEquipSet(0),
	}
	if err := authority.CreateCharacter(doorTestDivision, "test-account", seed); err != nil {
		t.Fatalf("CreateCharacter: %v", err)
	}
	character := authority.Characters().CharactersForDivision(doorTestDivision)[0]

	deps := &enterworld.Deps{Characters: authority.Characters()}
	deps.MutateCharacter = func(c *enterworld.Character, label string, fn func()) {
		authority.MutateCharacter(c, label, fn)
	}
	deps.ReadCharacter = func(divisionID string, fn func()) {
		authority.ReadCharacters(divisionID, func([]*enterworld.Character) { fn() })
	}
	// The guild door too: peerAppearance only dereferences GuildID when a
	// GuildStore is wired, and the fixed path must resolve the guild
	// OUTSIDE the read door (guilds.Guild takes the store lock - inside
	// the door it would deadlock, not race).
	deps.Guilds = authority.Guilds()

	rt := NewRuntime(deps, simulation.NewWorldStore())
	values := &recordedWorld{}
	rt.WorldBound(values, doorTestDivision, character)
	provider := values.snapshot.(worldsession.SnapshotProvider)

	const iterations = 200
	guildID := int64(1)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			swap := raceEquipSet(i)
			deps.Mutate(character, "inv-move", func() {
				character.MissionInventory = swap
				if i%2 == 0 {
					character.GuildID = nil
				} else {
					character.GuildID = &guildID
				}
			})
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			snapshot := provider.WorldSnapshot()
			if snapshot.CharacterID != character.ID {
				t.Errorf("snapshot character id = %d, want %d", snapshot.CharacterID, character.ID)
				return
			}
		}
	}()
	wg.Wait()
}
