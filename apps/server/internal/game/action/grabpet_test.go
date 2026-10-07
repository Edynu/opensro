/*
===========================================================================

grabpet_test.go - pickup companions remain outside combat

===========================================================================
*/
package action

import (
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

/*
================
TestGrabPetCannotBeAttackedOrAcquired
================
*/
func TestGrabPetCannotBeAttackedOrAcquired(t *testing.T) {
	rt, clock, c, mon := newCombatTestRuntime(t, 100)
	equipCombatTestPet(t, rt, c, 4)
	mon.Ref.DefaultSkillIDs[0] = 2
	before := c.ActiveCOS.CurrentHP
	c.BattleUntilMs = 0
	result := rt.MonsterBasicAttack(testDivision, mon, c.ActiveCOS.GID, 2, clock.NowMs())
	if result.Accepted || c.ActiveCOS.CurrentHP != before || c.BattleUntilMs != 0 {
		t.Fatalf("grab pet entered combat: %+v", result)
	}
	for _, target := range rt.CompanionTargets(testDivision, enterworld.ObjectIDForCharacter(c), clock.NowMs()) {
		if target.Gid == c.ActiveCOS.GID {
			t.Fatal("grab pet appears in monster acquisition candidates")
		}
	}
}
