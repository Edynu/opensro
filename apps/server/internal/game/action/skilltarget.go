/*
===========================================================================

skilltarget.go - may this skill act on that player?

The player-target part of TargetValidation_ValidateAllTargets (58CC70) and
Skill_ValidateTargetPermissions (58D7A0), read against the row's target
columns (enterworld.SkillTargets), and the walk into reach that the command
actor makes before a player-targeted cast. Target vfuncs: IsPlayer 482560,
IsNPC 4825C0, IsMonster 482600, GetLifeStateByte 485EE0, GetMotionState
4AA590.

===========================================================================
*/

package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

/*
==================
playerSkillTarget

58CC70 for a player target. Returns 0 to admit, else the refusal code:

  - missing, or on another plane or sector              0x3006
  - dead, unless the row has Enemy_P or resu (58CDF1)   0x3006
  - refused by skillTargetPermission                    0x3006
  - resu, above a nonzero word 0 (58D0CE)               0x3012

A living target passes a resu row; the cast then proposes nothing.
==================
*/
func (rt *Runtime) playerSkillTarget(division string, caster, target *enterworld.Character, skill enterworld.SkillRow, now int64) uint16 {
	if target == nil {
		return 0x3006
	}
	from := rt.liveSpawn(simulation.WorldKey(division, caster.Name), caster, now)
	to := rt.liveSpawn(simulation.WorldKey(division, target.Name), target, now)
	if !samePlaneAdjacent(from, to) {
		return 0x3006
	}

	alive := enterworld.CharacterAlive(target)
	if !alive && !skill.Targets.EnemyP && !skill.Abnormal.AdmitDeadParty {
		return 0x3006
	}

	sameParty := rt.sharePartyObject(division, caster, target)
	if !skillTargetPermission(skill.Targets, caster == target, alive, sameParty) {
		return 0x3006
	}

	if skill.Duplicate.Pinned {
		if code := rt.duplicateTargetRefusal(target, skill.Duplicate.MaxLevel); code != 0 {
			return code
		}
	}

	resu := skill.Abnormal
	if resu.AdmitDeadParty && resu.ResuMaxLevel != 0 && target.Level != nil &&
		*target.Level > int64(resu.ResuMaxLevel) {
		return 0x3012
	}
	return 0
}

/*
==================
skillTargetPermission

58D7A0 for a player caster and a player target, in its order:

  - Enemy_M admits at once
  - no Animal and the target is the caster: refuse
  - Enemy_P and a living target: refuse
  - Self without Ally: refuse (the target is a player)
  - Building without Land or Animal: both must have a party object
    (+0x1CB8) with the same id (CGObjPC_GetPartyID 4EA280)

Motion 8 without da (+0x240) would also refuse; players here have no
motion-8 channel, only sit, so that compare cannot fire.
==================
*/
func skillTargetPermission(t enterworld.SkillTargets, sameObject, targetAlive, sameParty bool) bool {
	if t.EnemyM {
		return true
	}
	if !t.Animal && sameObject {
		return false
	}
	if t.EnemyP && targetAlive {
		return false
	}
	if t.Self && !t.Ally {
		return false
	}
	buildingOnly := t.Building && !t.Land && !t.Animal
	if buildingOnly && !sameParty {
		return false
	}
	return true
}

// sharePartyObject reports both players in one party (both +0x1CB8 set and
// equal ids).
func (rt *Runtime) sharePartyObject(division string, a, b *enterworld.Character) bool {
	party := rt.auraParty(division, a)
	return len(party) != 0 && party[enterworld.ObjectIDForCharacter(b)]
}

/*
===============================================================================

REACH

===============================================================================
*/

/*
==================
supportTargetSpacing

The reach a player-targeted cast needs: both body radii plus column 21.
A row without a pinned range never waits for reach (ok with pinned false).
==================
*/
func (rt *Runtime) supportTargetSpacing(caster, target *enterworld.Character, skill enterworld.SkillRow) (spacing simulation.CombatSpacing, pinned, ok bool) {
	if !skill.ActionRangePinned {
		return spacing, false, true
	}
	spacing, ok = rt.playerToPlayerCombatSpacing(caster, target, simulation.ActionReach(skill.ActionRange))
	return spacing, true, ok
}

/*
==================
beginSupportApproach

Native 58D8F0 never refuses a target for range: the command actor walks
the caster into reach first. The port keeps that command as a support
intent (basicAttackIntent.SupportCast); the simulation tick keeps walking
and casts once the target is in reach (advanceSupportCastIntent).
==================
*/
func (rt *Runtime) beginSupportApproach(division string, character, snapshot *enterworld.Character, cast wire.SkillAction, spacing simulation.CombatSpacing, from, to simulation.Spawn, nowMs int64) OpResult {
	intent := basicAttackIntent{
		SupportCast:   true,
		DivisionID:    division,
		CharacterName: snapshot.Name,
		TargetGid:     cast.TargetGid,
		SkillID:       cast.ActionId,
		ActionReach:   spacing.ActionReach,
	}
	rt.setCombatIntent(intent)
	return rt.approachIntentTarget(character, snapshot, intent, spacing, from, to, nowMs)
}

/*
==================
advanceSupportCastIntent

One tick of a support intent: give up when the caster or target is gone
or the caster is dead or seated, keep walking while out of reach, else
stop, face the target and run the cast. The cast owner re-arms the intent
if the target has moved away again.
==================
*/
func (rt *Runtime) advanceSupportCastIntent(character *enterworld.Character, intent basicAttackIntent, nowMs int64) OpResult {
	division := intent.DivisionID
	snapshot := rt.characterSnapshot(division, character)
	recipient := rt.characterSnapshot(division, rt.findCharacterByGid(division, intent.TargetGid))
	skills := rt.deps.SkillData()
	if snapshot == nil || snapshot.DeletePending || !enterworld.CharacterAlive(snapshot) ||
		recipient == nil || skills == nil || rt.skillCastPostureBlocked(division, snapshot, nowMs) {
		rt.ClearCombatIntent(division, intent.CharacterName)
		return OpResult{}
	}
	skill, known := skills.SkillByID(intent.SkillID)
	if !known {
		rt.ClearCombatIntent(division, intent.CharacterName)
		return OpResult{}
	}
	spacing, pinned, ok := rt.supportTargetSpacing(snapshot, recipient, skill)
	if !ok {
		rt.ClearCombatIntent(division, intent.CharacterName)
		return OpResult{}
	}

	worldKey := simulation.WorldKey(division, snapshot.Name)
	from := rt.liveSpawn(worldKey, snapshot, nowMs)
	to := rt.liveSpawn(simulation.WorldKey(division, recipient.Name), recipient, nowMs)
	if pinned && !spacing.Contains(from, to) {
		if !rt.pursuitSteerDue(intent, worldKey, snapshot, to, nowMs) {
			return OpResult{}
		}
		return rt.approachIntentTarget(character, snapshot, intent, spacing, from, to, nowMs)
	}

	rt.ClearCombatIntent(division, intent.CharacterName)
	transition, transitioned := rt.enterBasicAttackRange(character, snapshot, worldKey, to, nowMs)
	if !transitioned {
		return OpResult{}
	}
	cast := wire.SkillAction{ActionId: intent.SkillID, HasTarget: true, TargetGid: intent.TargetGid}
	if skill.TimedEffect.Targeted {
		return prependOpResult(transition, rt.acceptTimedTargetEffect(division, character, rt.characterSnapshot(division, character), cast, skill, nowMs))
	}
	if skill.Duplicate.Pinned {
		return prependOpResult(transition, rt.acceptDuplicate(division, character, rt.characterSnapshot(division, character), cast, skill, nowMs))
	}
	result, _ := rt.acceptSupportSkillPhase(division, character, rt.characterSnapshot(division, character), cast, skill, nowMs, nil)
	return prependOpResult(transition, result)
}
