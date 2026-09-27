/*
===========================================================================

keepergauge_test.go - HP clamps against the keeper maximum

===========================================================================
*/

package action

import (
	"testing"

	"opensro.online/server/internal/game/abnormal"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

type gaugeOptions map[uint32]*enterworld.MagicOptionRow

func (m gaugeOptions) MagicOptionByParamID(id uint32) (*enterworld.MagicOptionRow, bool) {
	row, ok := m[id]
	return row, ok
}

func hpTag() uint32 {
	var tag uint32
	for _, b := range []byte("hp") {
		tag = tag<<8 | uint32(b)
	}
	return tag
}

// A +HP item raises param 3. A monster hit must start from that maximum,
// not from the closed form, so the stored current falls by exactly the damage.
func TestItemHPMonsterHitDropsByDamage(t *testing.T) {
	rt, clock, c, m := newCombatTestRuntime(t, 100)
	armor := &enterworld.ItemRef{RefObjID: 9, Codename: "TEST_HP_ARMOR", TypeIDs: [4]int64{3, 1, 1, 1}, Combat: &enterworld.ItemCombatRef{}}
	items := rt.deps.ItemReferences().(staticItemSource)
	items[armor.Codename] = armor
	rt.deps.(*enterworld.Deps).Items = items
	rt.deps.(*enterworld.Deps).MagicOptions = gaugeOptions{140: {ParamID: 140, OptionName: "MATTR_HP", Tag: hpTag()}}
	c.MissionInventory = append(c.MissionInventory, enterworld.InventoryRow{
		Slot: 1, RefObjID: armor.RefObjID, Codename: armor.Codename, TypeFlags: armor.TypeFlags(),
		VarianceBits: "0", Durability: 1, StackCount: 1, MagicOptions: []uint64{uint64(300)<<32 | 140},
	})
	c.CurrentHP = nil
	maxHP, _, full, _ := rt.playerKeeperVitals(testDivision, c)
	derived := enterworld.DerivedMaxHP(c)
	if maxHP != derived+300 || full != maxHP {
		t.Fatalf("keeper max %d full %d derived %d", maxHP, full, derived)
	}
	m.Ref.DefaultSkillIDs[0] = 2
	skills := rt.deps.SkillData().(staticSkillSource)
	skill := skills[2]
	skill.Attack.Min, skill.Attack.Max, skill.Attack.Percent = 1, 1, 100
	skills[2] = skill
	var result simulation.MonsterAttackResult
	rt.RunMonsterAction(testDivision, func(attack simulation.MonsterAttackOperation) {
		result = attack(testDivision, m, enterworld.ObjectIDForCharacter(c), 2, clock.NowMs())
	})
	unlock := rt.lockDivision(testDivision)
	unlock()
	if !result.Accepted || c.CurrentHP == nil {
		t.Fatalf("hit accepted %v hp %v", result.Accepted, c.CurrentHP)
	}
	if *c.CurrentHP >= full || full-*c.CurrentHP > full-derived {
		t.Fatalf("hit started from the closed form: full %d after %d derived %d", full, *c.CurrentHP, derived)
	}
}

func TestUnequipClampsCurrentHP(t *testing.T) {
	rt, _, c, _ := newCombatTestRuntime(t, 100)
	armor := &enterworld.ItemRef{RefObjID: 9, Codename: "TEST_HP_ARMOR", TypeIDs: [4]int64{3, 1, 1, 1}, Combat: &enterworld.ItemCombatRef{}}
	items := rt.deps.ItemReferences().(staticItemSource)
	items[armor.Codename] = armor
	rt.deps.(*enterworld.Deps).Items = items
	rt.deps.(*enterworld.Deps).MagicOptions = gaugeOptions{140: {ParamID: 140, OptionName: "MATTR_HP", Tag: hpTag()}}
	c.MissionInventory = append(c.MissionInventory, enterworld.InventoryRow{
		Slot: 1, RefObjID: armor.RefObjID, Codename: armor.Codename, TypeFlags: armor.TypeFlags(),
		VarianceBits: "0", Durability: 1, StackCount: 1, MagicOptions: []uint64{uint64(300)<<32 | 140},
	})
	maxHP, _, _, _ := rt.playerKeeperVitals(testDivision, c)
	c.CurrentHP = &maxHP
	result := rt.applyInventoryMove(testDivision, c, wire.ItemMoveRequest{MovementType: wire.MoveTypeInventory, SourceSlot: 1, DestSlot: 13, Quantity: 1})
	if result.DiagnosticRefusal != "" && len(result.Frames) == 0 {
		t.Fatal(result.DiagnosticRefusal)
	}
	_, _, current, _ := rt.playerKeeperVitals(testDivision, c)
	bare := enterworld.DerivedMaxHP(c)
	if current != bare || c.CurrentHP == nil || *c.CurrentHP != bare {
		t.Fatalf("unequip left hp %d stored %v bare %d", current, c.CurrentHP, bare)
	}
}

func TestPanicClampsCurrentHP(t *testing.T) {
	rt, clock, c, m := newCombatTestRuntime(t, 100)
	full := enterworld.DerivedMaxHP(c)
	c.CurrentHP = &full
	var owner *playerAbnormalOwner
	rt.deps.Update(c, "panic", func() bool {
		owner = rt.applyPlayerAbnormalInDoor(testDivision, c, false, []abnormal.Record{{
			Status: abnormal.Panic, DurationMs: 10000, Grade: 1, Param2C: 50, Param38: 1, SourceGID: m.Gid,
		}}, clock.NowMs())
		return true
	})
	if owner == nil || c.CurrentHP == nil || *c.CurrentHP >= full {
		t.Fatalf("panic did not clamp %v from %d", c.CurrentHP, full)
	}
}

func TestDeathStoresZeroHP(t *testing.T) {
	rt, clock, c, m := newCombatTestRuntime(t, 100)
	one := int64(1)
	c.CurrentHP = &one
	m.Ref.DefaultSkillIDs[0] = 2
	skills := rt.deps.SkillData().(staticSkillSource)
	skill := skills[2]
	skill.Attack.Min, skill.Attack.Max, skill.Attack.Percent = 50, 50, 100
	skills[2] = skill
	rt.RunMonsterAction(testDivision, func(attack simulation.MonsterAttackOperation) {
		attack(testDivision, m, enterworld.ObjectIDForCharacter(c), 2, clock.NowMs())
	})
	unlock := rt.lockDivision(testDivision)
	unlock()
	if c.CurrentHP == nil || *c.CurrentHP != 0 {
		t.Fatalf("death stored %v", c.CurrentHP)
	}
}

/*
==================
TestItemMPPercentageCostUsesKeeperMaximum

Skill admission and commit charge percentage MP against the keeper maximum
(param 4, which a +MP item raises), and an item-raised current above the
closed form is spendable.
==================
*/
func TestItemMPPercentageCostUsesKeeperMaximum(t *testing.T) {
	rt, _, c, _ := newCombatTestRuntime(t, 100)
	armor := &enterworld.ItemRef{RefObjID: 9, Codename: "TEST_MP_ARMOR", TypeIDs: [4]int64{3, 1, 1, 1}, Combat: &enterworld.ItemCombatRef{}}
	items := rt.deps.ItemReferences().(staticItemSource)
	items[armor.Codename] = armor
	rt.deps.(*enterworld.Deps).Items = items
	rt.deps.(*enterworld.Deps).MagicOptions = gaugeOptions{152: {ParamID: 152, OptionName: "MATTR_MP", Tag: uint32('m')<<8 | uint32('p')}}
	c.MissionInventory = append(c.MissionInventory, enterworld.InventoryRow{
		Slot: 1, RefObjID: armor.RefObjID, Codename: armor.Codename, TypeFlags: armor.TypeFlags(),
		VarianceBits: "0", Durability: 1, StackCount: 1, MagicOptions: []uint64{uint64(500)<<32 | 152},
	})
	_, maxMP, _, _ := rt.playerKeeperVitals(testDivision, c)
	derived := enterworld.DerivedMaxMP(c)
	if maxMP != derived+500 {
		t.Fatalf("keeper max MP %d derived %d", maxMP, derived)
	}
	skill := enterworld.SkillRow{Group: 7, Consumption: enterworld.SkillConsumption{MP: 3, MPPercent: 10, Pinned: true}}
	want := int64(3) + maxMP*10/100
	c.CurrentMP = &maxMP
	cost, code := rt.offensiveCost(testDivision, c, skill, 100)
	if code != 0 || cost != want {
		t.Fatalf("cost %d/%x want %d from keeper max %d", cost, code, want, maxMP)
	}
	rt.commitOffensiveCost(testDivision, c, skill, skillCharge{mp: cost}, 100)
	if *c.CurrentMP != maxMP-want {
		t.Fatalf("committed MP %d want %d", *c.CurrentMP, maxMP-want)
	}
}
