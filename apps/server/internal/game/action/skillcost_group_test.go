/*
===========================================================================

skillcost_group_test.go - shared cooldown groups across upgrades and persistence

===========================================================================
*/

package action

import (
	"encoding/json"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestSkillCooldownGroupsSurviveUpgradeSnapshotAndPersistence(t *testing.T) {
	rt, _, _, _ := newCombatTestRuntime(t, 100)
	c := &enterworld.Character{}
	first := enterworld.SkillRow{ID: 114, Group: 261, CoolTimeGroup: 59, CoolTimeMs: 5000, Consumption: enterworld.SkillConsumption{Pinned: true}}
	other := first
	other.ID = 19636
	other.Group = 768
	registerOffensiveCooldown(c, first, 100)
	if _, code := rt.offensiveCost(testDivision, c, other, 5099); code != 0x3005 {
		t.Fatalf("shared family bypass: %x", code)
	}
	clone := c.Snapshot()
	clone.SharedSkillCooldowns[59] = 0
	if c.SharedSkillCooldowns[59] != 5100 {
		t.Fatal("snapshot aliases cooldowns")
	}
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored enterworld.Character
	if err = json.Unmarshal(b, &restored); err != nil {
		t.Fatal(err)
	}
	if _, code := rt.offensiveCost(testDivision, &restored, other, 5099); code != 0x3005 {
		t.Fatal("reconnect lost shared cooldown")
	}
	if _, code := rt.offensiveCost(testDivision, &restored, other, 5100); code != 0 {
		t.Fatalf("exact boundary refused: %x", code)
	}
	other.CoolTimeMs = 0
	if _, code := rt.offensiveCost(testDivision, c, other, 101); code != 0 {
		t.Fatal("zero-duration native cooldown must skip shared lookup")
	}
	other.CoolTimeMs = 5000
	other.CoolTimeGroup = 0
	if _, code := rt.offensiveCost(testDivision, c, other, 101); code != 0 {
		t.Fatal("zero group coupled unrelated families")
	}
	other.CoolTimeGroup = 60
	if _, code := rt.offensiveCost(testDivision, c, other, 101); code != 0 {
		t.Fatal("different group coupled")
	}
	registerOffensiveCooldown(c, other, 5100)
	if _, ok := c.SharedSkillCooldowns[59]; ok {
		t.Fatal("expired group was not retired")
	}
}
