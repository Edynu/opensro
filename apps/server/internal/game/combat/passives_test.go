/*
===========================================================================

passives_test.go - tests for passives.go

===========================================================================
*/

package combat

import (
	"encoding/json"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

type passiveSkills map[uint32]enterworld.SkillRow

func (s passiveSkills) SkillByID(id uint32) (enterworld.SkillRow, bool) { r, ok := s[id]; return r, ok }

func TestPassiveCriticalSnapshotLifecycle(t *testing.T) {
	ref := &enterworld.ItemRef{RefObjID: 10, Codename: "TWOHAND", TypeIDs: [4]int64{3, 1, 6, 8}, MaxDurability: 100, Combat: &enterworld.ItemCombatRef{CriticalRate: enterworld.ItemStatRange{Min: 3, Max: 3}}}
	items := itemRefs{ref.Codename: ref}
	skills := passiveSkills{10: {ID: 10, Group: 434, Level: 1, PassiveCritical: enterworld.SkillPassiveCritical{Pinned: true, Flat: 2, WeaponKind: 8}}, 11: {ID: 11, Group: 434, Level: 2, PassiveCritical: enterworld.SkillPassiveCritical{Pinned: true, Flat: 3, WeaponKind: 8}}, 12: {ID: 12, Group: 77, Level: 1, CriticalModifier: enterworld.SkillCriticalModifier{Present: true, Flat: 99}}}
	c := &domain.Character{Level: pointer(30), Strength: pointer(49), Intellect: pointer(49), CurrentHP: pointer(100), MissionInventory: []domain.InventoryRow{{Slot: 6, RefObjID: 10, Codename: ref.Codename, VarianceBits: "0", Durability: 100}}}
	check := func(want float64) {
		t.Helper()
		got, _, err := PlayerStats(c, Catalogs{Items: items, Skills: skills})
		if err != nil || got.CriticalRate != want {
			t.Fatalf("rate=%v err=%v want=%v", got.CriticalRate, err, want)
		}
	}
	check(3)
	c.Skills = []uint32{10, 12}
	check(5)
	for i := 0; i < 4; i++ {
		c.MissionInventory[0].Slot = 13
		check(0)
		c.MissionInventory[0].Slot = 6
		check(5)
	}
	c.Skills = []uint32{11, 12}
	check(6)
	c.Skills = []uint32{10, 11, 11, 12}
	check(6) // historical duplicates cannot stack
	c.CurrentHP = pointer(0)
	check(6)
	c.CurrentHP = pointer(100)
	check(6)
	c.MissionInventory[0].Durability = 0
	check(0)
	c.MissionInventory[0].Durability = 100
	check(6)
	encoded, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored domain.Character
	if err = json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	c = &restored
	check(6)
	ref.TypeIDs[3] = 6
	check(3) // wrong weapon, identical numeric base crit
	ref.TypeIDs[3] = 8
	check(6)
	c.Skills = nil
	check(3)
	c.Skills = []uint32{10}
	if _, _, err = PlayerStats(c, Catalogs{Items: items}); err == nil {
		t.Fatal("missing authority silently omitted passive")
	}
}
