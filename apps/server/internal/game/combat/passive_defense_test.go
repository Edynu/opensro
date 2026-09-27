/*
===========================================================================

passive_defense_test.go - passive defense parameters

===========================================================================
*/

package combat

import (
	"encoding/json"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestPassiveDefenseSnapshotLifecycle(t *testing.T) {
	skills := passiveSkills{1: {ID: 1, Group: 9, Level: 1, PassiveDefense: enterworld.SkillPassiveDefense{Pinned: true, Physical: 2}}, 2: {ID: 2, Group: 9, Level: 2, PassiveDefense: enterworld.SkillPassiveDefense{Pinned: true, Physical: 5}}, 3: {ID: 3, Group: 10, Level: 1, PassiveDefense: enterworld.SkillPassiveDefense{Pinned: true, Magical: 7}}}
	c := &domain.Character{Level: pointer(30), Strength: pointer(49), Intellect: pointer(49), CurrentHP: pointer(100)}
	base, _, err := PlayerStats(c, Catalogs{Items: itemRefs{}, Skills: skills})
	if err != nil {
		t.Fatal(err)
	}
	check := func(p, m float32) {
		t.Helper()
		got, _, err := PlayerStats(c, Catalogs{Items: itemRefs{}, Skills: skills})
		wp, wm := base.PhysicalDefense, base.MagicalDefense
		if p != 0 {
			wp = float64(float32(wp) + p)
		}
		if m != 0 {
			wm = float64(float32(wm) + m)
		}
		if err != nil || got.PhysicalDefense != wp || got.MagicalDefense != wm {
			t.Fatalf("got %+v err %v want %v/%v", got, err, wp, wm)
		}
	}
	check(0, 0)
	c.Skills = []uint32{1}
	check(2, 0)
	c.Skills = []uint32{1, 2, 2, 3}
	check(5, 7)
	c.CurrentHP = pointer(0)
	check(5, 7)
	c.CurrentHP = pointer(100)
	check(5, 7)
	b, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored domain.Character
	if err = json.Unmarshal(b, &restored); err != nil {
		t.Fatal(err)
	}
	c = &restored
	check(5, 7)
	c.Skills = []uint32{1, 3}
	check(2, 7)
	c.Skills = nil
	check(0, 0)
	c.Skills = []uint32{2}
	r := skills[2]
	r.ChainNext = 123
	skills[2] = r
	check(0, 0)
}

func TestPassiveDefenseWeaponLifecycle(t *testing.T) {
	ref := &enterworld.ItemRef{RefObjID: 10, Codename: "ONEHAND", TypeIDs: [4]int64{3, 1, 6, 7}, MaxDurability: 100, Combat: &enterworld.ItemCombatRef{}}
	items := itemRefs{ref.Codename: ref}
	row := enterworld.SkillRow{ID: 1, Group: 1, Level: 1, PassiveDefense: enterworld.SkillPassiveDefense{Pinned: true, Physical: 3}}
	row.Reqi = enterworld.SkillReqi{Present: true, Count: 1}
	row.Reqi.Pairs[0] = enterworld.SkillReqiPair{Kind: 6, Value: 7}
	skills := passiveSkills{1: row}
	c := &domain.Character{Level: pointer(30), Strength: pointer(49), Intellect: pointer(49), MissionInventory: []domain.InventoryRow{{Slot: 6, RefObjID: 10, Codename: ref.Codename, VarianceBits: "0", Durability: 100}}}
	base, _, err := PlayerStats(c, Catalogs{Items: items, Skills: skills})
	if err != nil {
		t.Fatal(err)
	}
	c.Skills = []uint32{1}
	check := func(active bool) {
		t.Helper()
		got, _, err := PlayerStats(c, Catalogs{Items: items, Skills: skills})
		want := base.PhysicalDefense
		if active {
			want = float64(float32(want) + 3)
		}
		if err != nil || got.PhysicalDefense != want {
			t.Fatalf("active %v got %v want %v err %v", active, got.PhysicalDefense, want, err)
		}
	}
	check(true)
	c.MissionInventory[0].Slot = 13
	check(false)
	c.MissionInventory[0].Slot = 6
	check(true)
	c.MissionInventory[0].Durability = 0
	check(false)
	c.MissionInventory[0].Durability = 100
	check(true)
	ref.TypeIDs[3] = 8
	check(false)
	ref.TypeIDs[3] = 7
	check(true)
}
