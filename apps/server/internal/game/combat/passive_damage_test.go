/*
===========================================================================

passive_damage_test.go - passive damage parameters

===========================================================================
*/

package combat

import (
	"encoding/json"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"reflect"
	"testing"
)

func TestPassiveDamageSnapshotReplacementAndEquipment(t *testing.T) {
	s := passiveSkills{1: {ID: 1, Group: 433, Level: 1, PassiveParameters: enterworld.SkillPassiveParameters{Pinned: true, Mask: 1 << enterworld.ParameterTwoHandPower, Values: enterworld.SkillParameterValues{enterworld.ParameterTwoHandPower: 4}}}, 2: {ID: 2, Group: 433, Level: 2, PassiveParameters: enterworld.SkillPassiveParameters{Pinned: true, Mask: 1 << enterworld.ParameterTwoHandPower, Values: enterworld.SkillParameterValues{enterworld.ParameterTwoHandPower: 7}}}}
	c := &domain.Character{Level: pointer(30), Strength: pointer(49), Intellect: pointer(49)}
	baseline, _, err := PlayerStats(c, Catalogs{Items: itemRefs{}, Skills: s})
	if err != nil {
		t.Fatal(err)
	}
	c.Skills = []uint32{1, 2, 1, 2}
	ref := &enterworld.ItemRef{RefObjID: 10, Codename: "WEAPON", TypeIDs: [4]int64{3, 1, 6, 8}, MaxDurability: 100, Combat: &enterworld.ItemCombatRef{}}
	items := itemRefs{"WEAPON": ref}
	c.MissionInventory = []domain.InventoryRow{{Slot: 6, RefObjID: 10, Codename: "WEAPON", VarianceBits: "0", Durability: 100}}
	for _, tc := range []struct {
		slot, durability int64
		kind             int64
	}{{6, 100, 8}, {13, 100, 8}, {6, 0, 8}, {6, 100, 6}, {6, 100, 8}} {
		c.MissionInventory[0].Slot = tc.slot
		c.MissionInventory[0].Durability = tc.durability
		ref.TypeIDs[3] = tc.kind
		got, _, err := PlayerStats(c, Catalogs{Items: items, Skills: s})
		if err != nil || got.SkillParameters[enterworld.ParameterTwoHandPower] != 7 {
			t.Fatalf("%+v %v", got, err)
		}
		got.SkillParameters[enterworld.ParameterTwoHandPower] = 0
		if !reflect.DeepEqual(got, baseline) {
			t.Fatal("setv changed displayed/base stats")
		}
	}
	b, _ := json.Marshal(c)
	var restored domain.Character
	if err := json.Unmarshal(b, &restored); err != nil {
		t.Fatal(err)
	}
	got, _, err := PlayerStats(&restored, Catalogs{Items: items, Skills: s})
	if err != nil || got.SkillParameters[enterworld.ParameterTwoHandPower] != 7 {
		t.Fatal("restore lost learned value", err)
	}
	restored.Skills = nil
	got, _, err = PlayerStats(&restored, Catalogs{Items: items, Skills: s})
	if err != nil || got.SkillParameters[enterworld.ParameterTwoHandPower] != 0 {
		t.Fatal("removed skill retained value", err)
	}
}

func TestTwoHandPowerBeforeDefenseAndPhysicalOnly(t *testing.T) {
	a := Stats{Level: 30, MaxLevel: 30, Strength: 49, Intellect: 49, PhysicalAttackMin: 100, PhysicalAttackMax: 100, MagicalAttackMin: 100, MagicalAttackMax: 100, SkillParameters: enterworld.SkillParameterValues{enterworld.ParameterTwoHandPower: 50}}
	d := Stats{Level: 30, PhysicalDefense: 80, MagicalDefense: 80}
	roll := func() (uint32, error) { return 0, nil }
	for _, flags := range []uint32{4, 8, 12} {
		for _, critical := range []bool{false, true} {
			attack := enterworld.SkillAttack{Present: true, Flags: flags, Percent: 100, Parameters: 1 << enterworld.ParameterTwoHandPower}
			got, err := ResolveOutcome(a, d, attack, roll, false, critical)
			if err != nil {
				t.Fatal(err)
			}
			// Independent oracle: 100 rolled point ->150 BEFORE subtracting
			// 80 defense. Integer conversion happens separately per lane.
			want := uint32(0)
			if flags&4 != 0 {
				if critical {
					want += 140
				} else {
					want += 70
				}
			}
			if flags&8 != 0 {
				want += 20
			}
			if got.Damage != want {
				t.Fatalf("flags%d critical%v damage%d want%d", flags, critical, got.Damage, want)
			}
			attack.Parameters = 0
			plain, _ := ResolveOutcome(a, d, attack, roll, false, critical)
			if flags&4 != 0 && plain.Damage >= got.Damage {
				t.Fatal("missing channel affected damage")
			}
		}
	}
}
