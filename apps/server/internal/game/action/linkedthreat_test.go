package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/statuseffect"
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

func TestLinkedThreatDispatchesSourceBeforeAttackerWithoutTransferringDamage(t *testing.T) {
	rt, clock, c, mob := newCombatTestRuntime(t, 10000)
	friend := *c
	friend.ID = 4
	friend.Name = "threat-source"
	rt.deps.(*enterworld.Deps).Characters = enterworld.StaticCharacterSource{testDivision: {c, &friend}}
	attacker, source := enterworld.ObjectIDForCharacter(c), enterworld.ObjectIDForCharacter(&friend)
	l := statuseffect.Link{DivisionID: testDivision, SourceName: friend.Name, TargetName: c.Name,
		SourceGID: source, TargetGID: attacker, SourceToken: 100, TargetToken: 101, SkillID: 7246, SkillGroup: 418,
		Group: 3, MaxOutgoing: 2, MaxDistance: 1500, ThreatPercent: 36, ExpiresAtMs: clock.NowMs() + 10000, ClientCancelable: true}
	if code := rt.effects.ApplyLink(l); code != 0 {
		t.Fatal(code)
	}
	rt.commitSkillHostility(testDivision, attacker, mob.Gid, enterworld.SkillRow{}, []simulation.MonsterDamageResult{{Applied: 101}}, clock.NowMs())
	after, _ := rt.Monsters.Get(testDivision, mob.Gid)
	if after.CurrentHP != mob.CurrentHP {
		t.Fatal("threat dispatch touched HP")
	}
	if after.Opponents[0].GID != source || after.Opponents[0].Damage != 0 || after.Opponents[0].Aggression != 36 {
		t.Fatalf("source: %+v", after.Opponents)
	}
	if after.Opponents[1].GID != attacker || after.Opponents[1].Damage != 101 || after.Opponents[1].Aggression != 65 {
		t.Fatalf("attacker: %+v", after.Opponents)
	}
	rt.effects.RequestVoluntaryStop(testDivision, c.Name, l.SkillID, 101)
	rt.commitSkillHostility(testDivision, attacker, mob.Gid, enterworld.SkillRow{}, []simulation.MonsterDamageResult{{Applied: 100}}, clock.NowMs())
	after, _ = rt.Monsters.Get(testDivision, mob.Gid)
	if after.Opponents[0].Aggression != 36 || after.Opponents[1].Aggression != 165 || after.Opponents[1].Damage != 201 {
		t.Fatalf("stopped link contributed: %+v", after.Opponents)
	}
}

func TestLinkedRangeUsesLiveHeightAndRetiresBothEffects(t *testing.T) {
	rt, clock, c, _ := newCombatTestRuntime(t, 10000)
	friend := *c
	friend.ID = 4
	friend.Name = "linked-source"
	rt.deps.(*enterworld.Deps).Characters = enterworld.StaticCharacterSource{testDivision: {c, &friend}}
	l := statuseffect.Link{DivisionID: testDivision, SourceName: friend.Name, TargetName: c.Name,
		SourceGID: enterworld.ObjectIDForCharacter(&friend), TargetGID: enterworld.ObjectIDForCharacter(c),
		SourceToken: 100, TargetToken: 101, SkillID: 7246, SkillGroup: 418, Group: 3, MaxOutgoing: 2, MaxDistance: 1500,
		ThreatPercent: 36, ExpiresAtMs: clock.NowMs() + 10000, ClientCancelable: true}
	if rt.effects.ApplyLink(l) != 0 {
		t.Fatal("apply")
	}
	key := simulation.WorldKey(testDivision, friend.Name)
	rt.Worlds.Update(key, func() simulation.WorldState { return simulation.SeedWorldState(&friend) }, func(w *simulation.WorldState) { w.Spawn.Y += 1500 })
	rt.advanceLinkedEffects(clock.NowMs())
	if _, ok := rt.effects.ThreatLink(testDivision, c.Name, clock.NowMs()); !ok {
		t.Fatal("inclusive boundary retired link")
	}
	rt.Worlds.Update(key, func() simulation.WorldState { return simulation.SeedWorldState(&friend) }, func(w *simulation.WorldState) { w.Spawn.Y++ })
	rt.advanceLinkedEffects(clock.NowMs())
	if len(rt.effects.DrainStopRequested()) != 2 {
		t.Fatal("pair not retired")
	}
	if _, ok := rt.effects.ThreatLink(testDivision, c.Name, clock.NowMs()); ok {
		t.Fatal("retired out-of-range link remained active")
	}
}
