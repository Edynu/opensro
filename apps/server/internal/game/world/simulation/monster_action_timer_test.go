package simulation

import "testing"

func TestMonsterActionTimerSurvivesRetaliationWithoutConsumingOtherTimers(t *testing.T) {
	ops, actor := monsterLegFixture(t, aggressiveTactics())
	s := ops.Monsters
	s.SetRandomSource(func() float64 { return 0 })
	s.CompleteMonsterSkillCommand(monsterTestDivision, actor.Gid, 2000, 100000)
	if !s.ArmRetaliation(monsterTestDivision, actor.Gid, PlayerObjectID(2)) {
		t.Fatal("retaliation refused")
	}
	if s.selectedAITimerReady(monsterTestDivision, actor.Gid, 101999) {
		t.Fatal("retaliation reset action timer")
	}
	if s.checkAITimer(monsterTestDivision, actor.Gid, 0, 101999) {
		t.Fatal("FOLLOW timer bypassed selected action timer")
	}
	if !s.selectedAITimerReady(monsterTestDivision, actor.Gid, 102000) {
		t.Fatal("action timer failed at deadline")
	}
	if !s.checkAITimer(monsterTestDivision, actor.Gid, 0, 102000) {
		t.Fatal("selected gate consumed unrelated immediate timer")
	}
	m, _ := s.Mover(monsterTestDivision, actor.Gid)
	if m.TargetGID() != PlayerObjectID(2) {
		t.Fatal("timer completion replaced retaliation target")
	}
	s.CompleteMonsterSkillCommand(monsterTestDivision, actor.Gid, 2000, 103000)
	s.ApplyDamage(monsterTestDivision, actor.Gid, actor.CurrentHP)
	if s.selectedAITimerReady(monsterTestDivision, actor.Gid, 200000) {
		t.Fatal("dead caster kept cadence authority")
	}
}
