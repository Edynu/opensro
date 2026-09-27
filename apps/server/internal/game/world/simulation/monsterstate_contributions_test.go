/*
===========================================================================

monsterstate_contributions_test.go - tests for monsterstate_contributions.go

===========================================================================
*/

package simulation

import (
	"math"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestRewardCountArmsFatalNestAndPartySpawnConsumesFlag(t *testing.T) {
	w := newLifecycleWorld(t, lifecycleRef(0), lifecycleNest(100))
	m := w.expectLive(0, 1)[0]
	w.s.ArmNestFromReward("division", m.Gid, 2)
	if w.nest(0).partyArmed {
		t.Fatal("live monster armed nest")
	}
	w.s.ApplyDamage("division", m.Gid, m.CurrentHP)
	w.s.ArmNestFromReward("division", m.Gid, 1)
	if w.nest(0).partyArmed {
		t.Fatal("one eligible member armed nest")
	}
	w.s.ArmNestFromReward("division", m.Gid, 2)
	if !w.nest(0).partyArmed {
		t.Fatal("fatal party reward did not arm nest")
	}
	w.s.ArmNestFromReward("division", m.Gid, 0)
	if !w.nest(0).partyArmed {
		t.Fatal("lower count cleared an existing mark")
	}
	w.kill(0, m.Gid)
	w.s.SetRandomSource(constantWord(0))
	next := w.expectLive(10000, 1)[0]
	if next.Rarity() != 0x10 || w.nest(0).partyArmed {
		t.Fatalf("party spawn/flag consumption: rarity=%x armed=%v", next.Rarity(), w.nest(0).partyArmed)
	}
}

func TestContributionConcurrentFatalPlansHaveOneOwner(t *testing.T) {
	s := damageTestState()
	m := firstDamageTestMonster(t, s, "credit")
	results := make(chan MonsterDamageResult, 8)
	var workers sync.WaitGroup
	for actor := uint32(1); actor <= 8; actor++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			rows := s.ApplyDamageSequence("credit", m.Gid, m.CurrentHP, []MonsterDamagePlan{{GID: m.Gid, Damage: 100, CreditGID: actor}})
			if len(rows) != 0 {
				results <- rows[0]
			}
		}()
	}
	workers.Wait()
	close(results)
	if len(results) != 1 {
		t.Fatalf("fatal owners: %d", len(results))
	}
	result := <-results
	if !result.Fatal || len(result.Contributions) != 1 || result.Contributions[0].Damage != 100 {
		t.Fatalf("refused contender contaminated winner: %+v", result)
	}
}

func TestContributionCommitRefusalFatalSnapshotAndRemoval(t *testing.T) {
	s := damageTestState()
	m := firstDamageTestMonster(t, s, "credit")
	hit := func(hp, damage, actor uint32) []MonsterDamageResult {
		return s.ApplyDamageSequence("credit", m.Gid, hp, []MonsterDamagePlan{{GID: m.Gid, Damage: damage, CreditGID: actor}})
	}
	if rows := hit(54, 10, 20); len(rows) != 1 || rows[0].Contributions != nil {
		t.Fatalf("nonfatal result: %+v", rows)
	}
	if rows := hit(54, 1000, 99); len(rows) != 0 {
		t.Fatal("stale hit committed")
	}
	rows := hit(44, 100, 10)
	want := []MonsterContribution{{10, 100}, {20, 10}}
	if len(rows) != 1 || !rows[0].Fatal || rows[0].Applied != 44 || !reflect.DeepEqual(rows[0].Contributions, want) {
		t.Fatalf("fatal credit must retain damage arguments, excluding rejected hit: %+v", rows)
	}
	rows[0].Contributions[0].Damage = 999
	if got := s.divs["credit"].contributionSnapshot(m.Gid); !reflect.DeepEqual(got, want) {
		t.Fatalf("snapshot aliases owner: %+v", got)
	}
	if rows := hit(0, 1, 99); len(rows) != 0 {
		t.Fatal("dead victim accepted attributed hit")
	}
	s.Defeat("credit", m.Gid, time.UnixMilli(10000))
	if len(s.divs["credit"].contributions) != 0 {
		t.Fatal("removed monster retained ledger")
	}
}

func TestContributionBatchRefusalDoesNotCreditEarlierVictim(t *testing.T) {
	s := damageTestState()
	m := firstDamageTestMonster(t, s, "credit")
	_, ok := s.ApplyDamageBatch("credit", []MonsterDamagePlan{
		{GID: m.Gid, ExpectedHP: 54, Damage: 1, CreditGID: 2},
		{GID: m.Gid + 1000, ExpectedHP: 54, Damage: 1, CreditGID: 2},
	})
	if ok || len(s.divs["credit"].contributions) != 0 {
		t.Fatal("refused batch credited damage")
	}
}

func TestContributionDwordOverflowAndUnattributedDamage(t *testing.T) {
	state := &divisionMonsterState{}
	state.recordContribution(1, 2, math.MaxUint32)
	state.recordContribution(1, 2, 2)
	state.recordContribution(1, 0, 100)
	state.recordContribution(1, 3, 0)
	if got := state.contributionSnapshot(1); !reflect.DeepEqual(got, []MonsterContribution{{2, 1}}) {
		t.Fatalf("dword accumulation: %+v", got)
	}
}

func TestContributionBurnSharesVictimLedgerAndRejectsStaleTick(t *testing.T) {
	s := damageTestState()
	m := firstDamageTestMonster(t, s, "credit")
	s.ApplyDamageSequence("credit", m.Gid, 54, []MonsterDamagePlan{{GID: m.Gid, Damage: 10, CreditGID: 20}})
	s.clock = func() time.Time { return time.UnixMilli(1000) }
	result, ok := burnTick(t, s, "credit", m.Gid, 30, 100, 3001)
	if !ok || !result.Fatal {
		t.Fatalf("fatal tick: %+v %v", result, ok)
	}
	// The ledger records the damage argument (100 / (parry/100 + 1)), not the HP debit.
	tick := uint32(float32(100 / (m.Ref.MagicalParry/100 + 1)))
	want := []MonsterContribution{{20, 10}, {30, tick}}
	if !reflect.DeepEqual(result.Contributions, want) {
		t.Fatalf("tick omitted earlier source or used HP debit: %+v", result.Contributions)
	}
	if plan, ok := s.PlanAbnormalUpdate("credit", m.Gid, 3001); ok {
		if _, committed := s.CommitAbnormalUpdate(plan, 3001); committed && len(plan.Effects.Hits) > 0 {
			t.Fatal("duplicate tick accepted")
		}
	}
	if got := s.divs["credit"].contributionSnapshot(m.Gid); !reflect.DeepEqual(got, want) {
		t.Fatalf("duplicate tick altered ledger: %+v", got)
	}
}
