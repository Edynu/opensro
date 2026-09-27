package quest

import (
	"encoding/json"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestQuestTravelBlocksFollowAuthoritativeJournal(t *testing.T) {
	rt := &Runtime{Defs: &Definitions{byRefID: map[uint32]*Definition{
		1: {QuestSpec: QuestSpec{TravelBlockMask: 0x60000}}, 2: {QuestSpec: QuestSpec{TravelBlockMask: 0x20000}},
	}}}
	c := &enterworld.Character{ActiveQuests: []enterworld.ActiveQuestRecord{{RefID: 1}, {RefID: 2}}}
	if rt.TravelBlocks(c) != 0x60000 {
		t.Fatal("combined blocks missing")
	}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored enterworld.Character
	if err := json.Unmarshal(b, &restored); err != nil {
		t.Fatal(err)
	}
	if rt.TravelBlocks(&restored) != 0x60000 {
		t.Fatal("reconnect lost restriction")
	}
	restored.ActiveQuests = restored.ActiveQuests[1:]
	if rt.TravelBlocks(&restored) != 0x20000 {
		t.Fatal("retiring one quest cleared another restriction")
	}
	restored.ActiveQuests = nil
	restored.CompletedQuestIds = []uint32{1, 2}
	if rt.TravelBlocks(&restored) != 0 {
		t.Fatal("completed/abandoned quests retain restriction")
	}
}
