package action

import (
	"testing"

	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
)

func TestMonsterImpactPlanningPreservesSourceThroughFatalSequence(t *testing.T) {
	rt, clock, character, target := newCombatTestRuntime(t, 10)
	plans, ok := rt.planMonsterImpacts(testDivision, character, enterworld.SkillRow{}, target,
		[]combat.Result{{Damage: 1}, {Damage: target.CurrentHP + 10}, {Damage: 900}}, clock.NowMs())
	if !ok {
		t.Fatal("impact planning refused")
	}
	impacts := rt.Monsters.ApplyDamageSequence(testDivision, target.Gid, target.CurrentHP, plans)
	if len(impacts) != 2 || !impacts[1].Fatal {
		t.Fatalf("fatal sequence: %+v", impacts)
	}
	credit := impacts[1].Contributions
	if len(credit) != 1 || credit[0].CreditGID != enterworld.ObjectIDForCharacter(character) || credit[0].Damage != target.CurrentHP+11 {
		t.Fatalf("source lost or post-fatal impact credited: %+v", credit)
	}
}
