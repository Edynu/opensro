package store

import (
	"fmt"
	"strings"
	"testing"

	"opensro.online/server/internal/game/enterworld"
)

// testQuestSeeder is a seeder-shaped stand-in (the testSkillSeeder
// posture): the CH creation quest record without the textdata dependency
// - the codename->record resolution itself is pinned by internal/game/quest's own
// tests against the shipped table.
func testQuestSeeder(raceKey string) ([]enterworld.ActiveQuestRecord, error) {
	if raceKey == enterworld.RaceKeyChina {
		return []enterworld.ActiveQuestRecord{{
			RefID: 2, Flags: 0x18, U10: 1,
			Contents: []enterworld.ActiveQuestContentsNode{
				{Tag: 1, Kind: 1, Description: "SN_CON_QTUTORIAL_CH_01", ObjectiveSentinel: true},
			},
		}}, nil
	}
	return nil, nil
}

// TestCreateCharacterSeedsDefaultQuests pins the Options.DefaultQuests
// creation hook: a Chinese creation seeds the tutorial record, a
// European creation seeds nothing, a NIL seeder seeds nothing (the
// documented optional posture - unlike DefaultSkills), and a WIRED
// seeder that fails refuses the creation before any mutation.
func TestCreateCharacterSeedsDefaultQuests(t *testing.T) {
	t.Parallel()
	clock := newTestClock()

	t.Run("CH seeds the tutorial, EU seeds nothing", func(t *testing.T) {
		t.Parallel()
		s, err := Open(t.TempDir(), Options{Now: clock.Now, DefaultSkills: testSkillSeeder, DefaultQuests: testQuestSeeder})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(s.Close)

		chinese := &enterworld.Character{Name: "chseed", ModelCodename: "CHAR_CH_MAN_ADVENTURER"}
		if err := s.CreateCharacter(testDivision, "test-account", chinese); err != nil {
			t.Fatal(err)
		}
		if len(chinese.ActiveQuests) != 1 || chinese.ActiveQuests[0].RefID != 2 {
			t.Fatalf("CH creation quests = %+v, want the seeded tutorial", chinese.ActiveQuests)
		}

		european := &enterworld.Character{Name: "euseed", ModelCodename: "CHAR_EU_MAN"}
		if err := s.CreateCharacter(testDivision, "test-account", european); err != nil {
			t.Fatal(err)
		}
		if len(european.ActiveQuests) != 0 {
			t.Fatalf("EU creation quests = %+v, want none", european.ActiveQuests)
		}
	})

	t.Run("nil seeder seeds nothing", func(t *testing.T) {
		t.Parallel()
		s, err := Open(t.TempDir(), Options{Now: clock.Now, DefaultSkills: testSkillSeeder})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(s.Close)
		c := &enterworld.Character{Name: "noquest", ModelCodename: "CHAR_CH_MAN_ADVENTURER"}
		if err := s.CreateCharacter(testDivision, "test-account", c); err != nil {
			t.Fatal(err)
		}
		if c.ActiveQuests != nil {
			t.Fatalf("quests = %+v, want none (optional wiring)", c.ActiveQuests)
		}
	})

	t.Run("a failing wired seeder refuses the creation", func(t *testing.T) {
		t.Parallel()
		s, err := Open(t.TempDir(), Options{
			Now:           clock.Now,
			DefaultSkills: testSkillSeeder,
			DefaultQuests: func(string) ([]enterworld.ActiveQuestRecord, error) {
				return nil, fmt.Errorf("codename QTUTORIAL_CH does not resolve")
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(s.Close)
		c := &enterworld.Character{Name: "refused", ModelCodename: "CHAR_CH_MAN_ADVENTURER"}
		err = s.CreateCharacter(testDivision, "test-account", c)
		if err == nil || !strings.Contains(err.Error(), "creation quest seed") {
			t.Fatalf("want the loud quest-seed refusal, got %v", err)
		}
		if got := len(s.Characters().CharactersForDivision(testDivision)); got != 0 {
			t.Fatalf("a refusal must mutate nothing, got %d records", got)
		}
	})
}
