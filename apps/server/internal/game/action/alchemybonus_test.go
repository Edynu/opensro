package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/alchemy"
	"opensro.online/server/internal/game/item/statuseffect"
	"testing"
)

func TestAlchemyBonusTracksActiveEffectAndRemoval(t *testing.T) {
	rt, c := alchemyRuntime()
	deps := rt.deps.(*enterworld.Deps)
	deps.Skills = staticSkillSource{1: {ID: 1, Group: 42, AlchemyStoneBonus: 10, AlchemyReinforceBonus: 5}}
	c.Skills = []uint32{1}
	if a, b := rt.alchemyBonuses(testDivision, c); a != 0 || b != 0 {
		t.Fatal("learned skill activated bonus")
	}
	if !rt.ApplyCharacterEffect(testDivision, c.Name, 1, 1, statuseffect.StateActive, true) {
		t.Fatal("effect admission failed")
	}
	if a, b := rt.alchemyBonuses(testDivision, c); a != 5 || b != 10 {
		t.Fatal(a, b)
	}
	if a, b := rt.alchemyBonuses("other", c); a != 0 || b != 0 {
		t.Fatal("cross-division bonus")
	}
	rt.effects.RequestVoluntaryStop(testDivision, c.Name, 1, 1)
	if a, b := rt.alchemyBonuses(testDivision, c); a != 0 || b != 0 {
		t.Fatal("stopped effect retained bonus")
	}
}

func TestAlchemyAvatarBonusOnlyComesFromWornOptions(t *testing.T) {
	rt, c := alchemyRuntime()
	rt.Alchemy.Magic[50] = alchemy.Magic{ID: 50, Tag: 0x6c756361}
	c.MissionInventory[0].MagicOptions = []uint64{uint64(4)<<32 | 50}
	if a, _ := rt.alchemyBonuses(testDivision, c); a != 0 {
		t.Fatal("bag option applied")
	}
	c.AvatarInventory = &enterworld.AvatarInventory{Rows: []enterworld.InventoryRow{{Slot: 1, MagicOptions: []uint64{uint64(4)<<32 | 50}}}}
	if a, _ := rt.alchemyBonuses(testDivision, c); a != 4 {
		t.Fatal(a)
	}
	c.AvatarInventory = nil
	if a, _ := rt.alchemyBonuses(testDivision, c); a != 0 {
		t.Fatal("removed avatar retained bonus")
	}
}

func TestAlchemyActiveBonusChangesLiveReinforcementOutcome(t *testing.T) {
	rt, c := alchemyRuntime()
	rt.deps.(*enterworld.Deps).Skills = staticSkillSource{1: {ID: 1, Group: 42, AlchemyReinforceBonus: 5}}
	if !rt.ApplyCharacterEffect(testDivision, c.Name, 1, 1, statuseffect.StateActive, true) {
		t.Fatal("effect admission failed")
	}
	rt.AlchemyRoll = func() (uint32, error) { return 27, nil }
	frames := rt.HandleAlchemyReinforce(testDivision, c, []byte{2, 20, 21})
	last := frames[len(frames)-1]
	if last.Opcode != alchemy.OpReinforceResult || last.Payload[0] != 1 || last.Payload[1] != 1 {
		t.Fatal("active bonus did not reach rule", frames)
	}
}
