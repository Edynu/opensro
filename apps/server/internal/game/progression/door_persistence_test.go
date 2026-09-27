package progression

// Store-backed continuity test for the stat plane's mutation sites: every
// granted allocation and every trained mastery level commits through the
// authority store's door, so a watchdog reboot resumes the character with
// the spent points and the raised values - never the pre-spend state (which
// would hand the points back and let a player farm them across restarts).

import (
	"path/filepath"
	"testing"

	"opensro.online/server/internal/data/store"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
)

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

// openDoorRuntime opens the authority store in dir and wires a stat
// runtime whose door commits through it. On a reopen the character comes
// back from the DATABASE, never from the seed.
func openDoorRuntime(t *testing.T, dir string, seed *enterworld.Character) (*Runtime, *enterworld.Character, *store.Store) {
	t.Helper()
	authority, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open(%s): %v", dir, err)
	}
	t.Cleanup(authority.Close)

	existing := authority.Characters().CharactersForDivision(testDivision)
	if len(existing) == 0 && seed != nil {
		if err := authority.CreateCharacter(testDivision, "test-account", seed); err != nil {
			t.Fatalf("CreateCharacter: %v", err)
		}
		existing = authority.Characters().CharactersForDivision(testDivision)
	}

	deps := &enterworld.Deps{
		Characters: authority.Characters(),
		Items:      emptyItemRefs{},
		Levels:     testLevels(),
		Skills:     testSkills(),
	}
	deps.MutateCharacter = func(c *enterworld.Character, label string, fn func()) {
		// The server wiring's scoped door.
		authority.MutateCharacter(c, label, fn)
	}

	var character *enterworld.Character
	if len(existing) > 0 {
		character = existing[0]
	}
	return NewRuntime(deps), character, authority
}

func TestStatSpendsSurviveRestart(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")

	seed := testCharacter()
	// CreateCharacter seeds the racial masteries itself; keep the stat
	// pools explicit so the deltas are unambiguous.
	seed.Masteries = nil
	rt, character, authority := openDoorRuntime(t, dir, seed)

	if got := rt.HandleAllocStr(testDivision, character, nil).Frames[0].Payload[0]; got != wire.ResultSuccess {
		t.Fatalf("strength allocation refused: %v", got)
	}
	if got := rt.HandleAllocInt(testDivision, character, nil).Frames[0].Payload[0]; got != wire.ResultSuccess {
		t.Fatalf("intellect allocation refused: %v", got)
	}
	// Two trains, covering both pricing legs across the same restart:
	// the seeded row sits at level 0, so the FIRST train is the pinned
	// free 0->1 (no SP moves), and the SECOND is the priced 1->2
	// (leveldata row of the level being left, row 1).
	for i := 0; i < 2; i++ {
		trained := rt.HandleMasteryLevelUp(testDivision, character, masteryPayload(chMastery, 1))
		if got := trained.Frames[0].Payload[0]; got != wire.ResultSuccess {
			t.Fatalf("mastery training %d refused: %v", i, trained.Frames[0].Payload)
		}
	}
	cost, _ := testLevels().SkillPointCost(1)
	authority.Close()

	// The watchdog reboot: a fresh store hydrated from the directory.
	_, restored, _ := openDoorRuntime(t, dir, nil)
	if restored == nil {
		t.Fatal("character lost across the restart")
	}
	if got := *restored.Strength; got != enterworld.BaseStat+1 {
		t.Fatalf("strength after reboot = %d, want %d", got, enterworld.BaseStat+1)
	}
	if got := *restored.Intellect; got != enterworld.BaseStat+1 {
		t.Fatalf("intellect after reboot = %d, want %d", got, enterworld.BaseStat+1)
	}
	if got := *restored.StatPoints; got != 1 {
		t.Fatalf("stat points after reboot = %d, want 1 (two of three spent)", got)
	}
	if got := *restored.SkillPoints; got != 100-cost {
		t.Fatalf("skill points after reboot = %d, want %d (free 0->1, then the priced 1->2 at row 1)", got, 100-cost)
	}
	level, ok := enterworld.MasteryLevel(restored, chMastery)
	if !ok || level != 2 {
		t.Fatalf("mastery level after reboot = %d/%v, want 2/true", level, ok)
	}
}

// The stat plane's own mutex only excludes OTHER stat operations, so the
// response snapshot must be taken inside the commit door: another lane
// mutating the same record concurrently would otherwise race the
// 0x343C block's reads of the character's vitals and stats. Run under
// -race; the door is the only thing that makes this safe.
func TestStatAllocRacesAnotherLaneMutation(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")

	seed := testCharacter()
	seed.Masteries = nil
	seed.StatPoints = int64Ptr(400)
	rt, character, authority := openDoorRuntime(t, dir, seed)

	const rounds = 150
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < rounds; i++ {
			// A foreign lane writing fields the 0x343C block reads.
			strength := int64(20 + i)
			intellect := int64(20 + i)
			authority.MutateCharacter(character, "other-lane", func() {
				character.Strength = &strength
				character.Intellect = &intellect
			})
		}
	}()

	for i := 0; i < rounds; i++ {
		result := rt.HandleAllocStr(testDivision, character, nil)
		if result.Frames[0].Payload[0] != wire.ResultSuccess {
			t.Fatalf("allocation %d refused with points remaining", i)
		}
		if len(result.Frames[1].Payload) != wire.BaseStatsSize {
			t.Fatalf("0x343C block = %d bytes mid-race", len(result.Frames[1].Payload))
		}
	}
	<-done
}

// A refusal must not commit anything: the pools come back untouched.
func TestRefusedSpendLeavesNothingPersisted(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")

	seed := testCharacter()
	seed.Masteries = nil
	seed.StatPoints = int64Ptr(0)
	rt, character, authority := openDoorRuntime(t, dir, seed)

	if got := rt.HandleAllocStr(testDivision, character, nil).Frames[0].Payload[0]; got != wire.ResultError {
		t.Fatalf("allocation without points was granted: %v", got)
	}
	authority.Close()

	_, restored, _ := openDoorRuntime(t, dir, nil)
	if got := *restored.Strength; got != enterworld.BaseStat {
		t.Fatalf("strength after reboot = %d, want the untouched %d", got, enterworld.BaseStat)
	}
	if got := *restored.StatPoints; got != 0 {
		t.Fatalf("stat points after reboot = %d, want 0", got)
	}
}
