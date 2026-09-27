package enterworld_test

import (
	"opensro.online/server/internal/data/store"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestAutoPotionRequestSurvivesStoreRestart(t *testing.T) {
	dir := t.TempDir()
	authority, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(authority.Close)
	if err := authority.CreateCharacter(doorDivision, "test-account", &enterworld.Character{
		Name: "PotionProbe", ModelCodename: "CHAR_CH_MAN_ADVENTURER",
	}); err != nil {
		t.Fatal(err)
	}
	live := authority.Characters().CharactersForDivision(doorDivision)[0]
	deps := doorDeps(t, authority)
	payload := []byte{2, 0x11, 0xb2, 0x12, 0xb2, 0x13, 0x80, 0x8a}
	if changed, err := enterworld.HandleQuickSlotMessage(deps, live, payload); err != nil || !changed {
		t.Fatalf("save = %v, %v", changed, err)
	}
	expected := live.AutoPotion
	authority.Close()
	reopened, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reopened.Close)
	restored := reopened.Characters().CharactersForDivision(doorDivision)[0]
	if restored.AutoPotion != expected {
		t.Fatalf("restored %v, want %v", restored.AutoPotion, expected)
	}
	if changed, err := enterworld.HandleQuickSlotMessage(doorDeps(t, reopened), restored, payload); err != nil || changed {
		t.Fatalf("duplicate after restart = %v, %v", changed, err)
	}
}
