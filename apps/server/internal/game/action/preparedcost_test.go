/*
===========================================================================

preparedcost_test.go - the prepared MP snapshot and release admission

===========================================================================
*/

package action

import (
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestPreparedCostSnapshotAndReleaseAdmission(t *testing.T) {
	rt, clock, c, _ := newCombatTestRuntime(t, 100000)
	skill := shippedOffense(t, "SKILL_CH_COLD_GANGGI_A_01")
	skill.Consumption.MP = 7
	skill.Consumption.MPPercent = 20
	maximum := enterworld.DerivedMaxMP(c)
	if maximum < 100 {
		t.Fatal("fixture MP too small", maximum)
	}
	c.CurrentMP = testInt64(maximum * 4 / 5)
	cost, err := rt.preparedExecutionMPCost(testDivision, c, skill)
	if err != nil {
		t.Fatal(err)
	}
	pending := &pendingProjectileCast{executionCost: skillCharge{mp: cost}}
	// Native phase mask 1C rechecks max-MP admission, but does not rewrite
	// context+14 when current MP changes during the cast delay.
	c.CurrentMP = testInt64(maximum / 2)
	got, refusal := rt.offensivePhaseCost(testDivision, c, skill, clock.NowMs(), pending)
	recomputed, err := rt.preparedExecutionMPCost(testDivision, c, skill)
	if err != nil {
		t.Fatal(err)
	}
	if refusal != 0 || got.mp != cost || got.mp == recomputed {
		t.Fatal("prepared charge recomputed", got, cost, refusal)
	}
	rt.commitOffensivePhaseCost(testDivision, c, skill, got, clock.NowMs(), true)
	if *c.CurrentMP != maximum/2-cost {
		t.Fatal(*c.CurrentMP)
	}
	c.CurrentMP = testInt64(0)
	if _, refusal := rt.offensivePhaseCost(testDivision, c, skill, clock.NowMs(), pending); refusal != 0x3004 {
		t.Fatal("release skipped native resource validation", refusal)
	}
}
