package quest

import (
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
)

func TestEuropeanStarterQuestNpcOfferAndTalkCompletion(t *testing.T) {
	defs := loadTestDefinitions(t)
	rt, err := NewRuntime(&enterworld.Deps{}, defs, func(*enterworld.Character, int64, int64, uint32) ([]wire.Frame, bool) {
		return nil, true
	})
	if err != nil {
		t.Fatal(err)
	}
	race, level := int64(enterworld.RaceEurope), int64(1)
	character := &enterworld.Character{Name: "EuStarter", RaceIndex: &race, Level: &level}

	options := rt.OptionsForNpc(character, "NPC_EU_ADVICE")
	if len(options) != 1 || options[0].Codename != "QNO_EU_TUTORIAL_1" || options[0].Complete {
		t.Fatalf("offer options = %+v", options)
	}
	if _, err := rt.StartQuest(character, options[0].Codename); err != nil {
		t.Fatal(err)
	}
	options = rt.OptionsForNpc(character, "NPC_EU_ADVICE")
	if len(options) != 1 || !options[0].Complete {
		t.Fatalf("active options = %+v, want one completion", options)
	}
	if _, err := rt.CompleteTalkQuest(character, options[0].Codename); err != nil {
		t.Fatal(err)
	}
	if len(character.ActiveQuests) != 0 || len(character.CompletedQuestIds) != 1 || character.CompletedQuestIds[0] != 143 {
		t.Fatalf("quest state active=%+v completed=%+v", character.ActiveQuests, character.CompletedQuestIds)
	}
	if options := rt.OptionsForNpc(character, "NPC_EU_ADVICE"); len(options) != 0 {
		t.Fatalf("completed quest offered again: %+v", options)
	}
}
