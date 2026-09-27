package simulation

import (
	"errors"
	"testing"

	"opensro.online/server/internal/game/world/monster"
)

func TestMonsterStateRetaliationRevisionRejectsOnlyStaleMoverCommits(t *testing.T) {
	ops, instance := monsterLegFixture(t, passiveTactics())
	const divisionID = monsterTestDivision
	stale, ok := ops.Monsters.Mover(divisionID, instance.Gid)
	if !ok {
		t.Fatal("live monster has no mover")
	}
	if stale.Mode() != monster.MoverIdle {
		t.Fatalf("fixture mover mode = %s, want idle", stale.Mode())
	}
	const attackerGID = uint32(100003)
	if !ops.Monsters.ArmRetaliation(divisionID, instance.Gid, attackerGID) {
		t.Fatal("live monster rejected retaliation")
	}

	if err := stale.Transition(monster.MoverEventStartWander, 0); err != nil {
		t.Fatalf("start stale wander: %v", err)
	}
	if ops.Monsters.CommitMover(divisionID, instance.Gid, stale) {
		t.Fatal("stale whole-value commit reported acceptance")
	}
	armed, _ := ops.Monsters.Mover(divisionID, instance.Gid)
	if armed.Mode() != monster.MoverChasing || armed.TargetGID() != attackerGID || !armed.Retaliating() ||
		!armed.RetaliationPending() || armed.RetaliationRevision() != 1 {
		t.Fatalf("stale commit erased retaliation: %+v", armed)
	}

	released := armed
	if err := released.Transition(monster.MoverEventTargetLost, 0); err != nil {
		t.Fatalf("release retaliation target: %v", err)
	}
	if !ops.Monsters.CommitMover(divisionID, instance.Gid, released) {
		t.Fatal("same-revision return commit rejected")
	}
	got, _ := ops.Monsters.Mover(divisionID, instance.Gid)
	if got.Mode() != monster.MoverReturning || got.TargetGID() != 0 || got.RetaliationPending() || got.Retaliating() {
		t.Fatalf("same-revision target release did not commit: %+v", got)
	}
}

func TestMonsterStateCommitMoverRejectsInvalidTuple(t *testing.T) {
	ops, instance := monsterLegFixture(t, passiveTactics())
	mover, ok := ops.Monsters.Mover(monsterTestDivision, instance.Gid)
	if !ok {
		t.Fatal("live monster has no mover")
	}
	mover.AttackReach = 10 // exported-field corruption fixture

	defer func() {
		recovered := recover()
		err, _ := recovered.(error)
		var transitionErr *monster.MoverTransitionError
		if !errors.As(err, &transitionErr) {
			t.Fatalf("CommitMover panic = %T %v, want *monster.MoverTransitionError", recovered, recovered)
		}
	}()
	ops.Monsters.CommitMover(monsterTestDivision, instance.Gid, mover)
	t.Fatal("CommitMover accepted an invalid behavior tuple")
}
