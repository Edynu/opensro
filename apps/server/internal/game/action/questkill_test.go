package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestFatalTransitionCreditsQuestOnlyOnceAndKeepsProgressPrivate(t *testing.T) {
	rt, _, character, target := newCombatTestRuntime(t, 1)
	calls := 0
	rt.UpdateQuestKill = func(c *enterworld.Character, code string, rarity uint8) ([]wire.Frame, bool) {
		if c != character || code != target.Ref.Codename {
			t.Fatal("wrong killer/monster identity")
		}
		calls++
		return []wire.Frame{{Opcode: 0x31ed, Payload: []byte{2}}}, true
	}
	attack := wire.SkillAction{ActionId: 2, HasTarget: true, TargetGid: target.Gid}.Encode()
	result := rt.HandleTargetInteract(testDivision, character, attack)
	if calls != 1 {
		t.Fatalf("quest callbacks = %d", calls)
	}
	found := false
	for _, f := range result.Frames {
		if f.Opcode == 0x31ed {
			found = true
		}
	}
	if !found {
		t.Fatal("quest update missing from acting session")
	}
	for _, f := range result.Broadcast {
		if f.Opcode == 0x31ed {
			t.Fatal("private quest progress broadcast")
		}
	}
	rt.HandleTargetInteract(testDivision, character, attack)
	if calls != 1 {
		t.Fatal("corpse attack repeated quest credit")
	}
}
