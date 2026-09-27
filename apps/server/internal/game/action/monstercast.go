package action

import (
	"fmt"
	"sync/atomic"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

// Preparing -> released or cancelled. Like pendingProjectileCast, this owner
// uses the simulation clock and division operation lock, never a goroutine.
// Native 58356C / 585BF8 retain positive casting time; 585F69 generates the
// release results. Client B245 admits preparation; B505 carries those results.
type pendingMonsterCast struct {
	division      string
	instance      monster.Instance
	target        uint32
	characterID   int64
	characterName string
	skill         uint32
	token         uint32
	releaseAtMs   int64
	selfEffect    bool
}

func (rt *Runtime) prepareMonsterCast(division string, instance monster.Instance, target *enterworld.Character, skill enterworld.SkillRow, now int64) simulation.MonsterAttackResult {
	rt.pendingSkillFinalizesMu.Lock()
	defer rt.pendingSkillFinalizesMu.Unlock()
	for _, p := range rt.pendingMonsterCasts {
		if p.division == division && p.instance.Gid == instance.Gid {
			return simulation.MonsterAttackResult{TargetAlive: true}
		}
	}
	p := pendingMonsterCast{division: division, instance: instance, target: enterworld.ObjectIDForCharacter(target), characterID: target.ID, characterName: target.Name, skill: skill.ID, token: atomic.AddUint32(&rt.castTokenCounter, 1), releaseAtMs: now + int64(skill.ActionCastingTimeMs) + 1}
	p.selfEffect = skill.MonsterSelfEffect.Pinned
	rt.pendingMonsterCasts = append(rt.pendingMonsterCasts, p)
	frame := wire.SkillCastUntargetedFrame(wire.SkillCastSuccess{SkillId: skill.ID, CasterGid: instance.Gid, InstanceToken: p.token, OwnerOrTargetGid: p.target})
	if p.selfEffect {
		frame = wire.SkillCastSelfFrame(wire.SkillCastSuccess{SkillId: skill.ID, CasterGid: instance.Gid, InstanceToken: p.token})
	}
	return simulation.MonsterAttackResult{Accepted: true, TargetAlive: true, Frames: []simulation.Frame{{Opcode: frame.Opcode, Payload: frame.Payload, Current: frame.Current, Scope: frame.Scope}}}
}

func (rt *Runtime) advanceMonsterCasts(now int64) []simulation.DivisionFrames {
	rt.pendingSkillFinalizesMu.Lock()
	pending := append([]pendingMonsterCast(nil), rt.pendingMonsterCasts...)
	rt.pendingSkillFinalizesMu.Unlock()
	var out []simulation.DivisionFrames
	for _, p := range pending {
		unlock := rt.lockDivision(p.division)
		attacker, exists := rt.Monsters.Get(p.division, p.instance.Gid)
		target := rt.findCharacterByGid(p.division, p.target)
		var snapshot *enterworld.Character
		if target != nil && target.ID == p.characterID {
			snapshot = rt.characterSnapshot(p.division, target)
		}
		valid := exists && attacker.CurrentHP > 0 && attacker.Motion.StateAt(now) == 0 && snapshot != nil && !snapshot.DeletePending && enterworld.CharacterAlive(snapshot)
		if p.selfEffect {
			valid = exists && attacker.CurrentHP > 0 && attacker.Motion.StateAt(now) == 0
		}
		if valid && !p.selfEffect {
			_, valid = rt.characterMonster(p.division, snapshot, attacker.Gid)
		}
		if valid && now < p.releaseAtMs {
			unlock()
			continue
		}
		// Teardown can win between the queue snapshot and the operation lock.
		owned := false
		rt.pendingSkillFinalizesMu.Lock()
		for i, row := range rt.pendingMonsterCasts {
			if row.token == p.token {
				rt.pendingMonsterCasts = append(rt.pendingMonsterCasts[:i], rt.pendingMonsterCasts[i+1:]...)
				owned = true
				break
			}
		}
		rt.pendingSkillFinalizesMu.Unlock()
		if !owned {
			unlock()
			continue
		}
		result := simulation.MonsterAttackResult{}
		if valid {
			result = rt.monsterAttackStage(p.division, p.instance, p.target, p.skill, now, &p)
		}
		if !result.Accepted {
			frame := wire.SkillCastFinalizeFrame(p.token)
			result.Frames = []simulation.Frame{{Opcode: frame.Opcode, Payload: frame.Payload, Current: frame.Current, Scope: frame.Scope}}
		}
		if rt.PushMonsterCast != nil {
			rt.PushMonsterCast(p.division, p.instance.Gid, p.characterName, result)
			unlock()
			continue
		}
		if len(result.Frames) > 0 {
			out = append(out, simulation.DivisionFrames{DivisionID: p.division, SourceGID: p.instance.Gid, Frames: result.Frames})
		}
		if len(result.TargetFrames) > 0 {
			out = append(out, simulation.DivisionFrames{DivisionID: p.division, OnlyCharacterID: p.characterID, Frames: result.TargetFrames})
		}
		unlock()
	}
	return out
}

func monsterCastOwner(gid uint32) string { return fmt.Sprintf("@monster:%d", gid) }
