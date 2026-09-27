package action

import (
	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

// Each impact contributes to the action's cumulative aggression (5903EC),
// while HP damage remains a separate amount. Resolve candidates from live
// authority, then let MonsterState commit the ledger and mover transition.
func (rt *Runtime) commitSkillHostility(division string, attacker, target uint32, skill enterworld.SkillRow, impacts []simulation.MonsterDamageResult, now int64) {
	if len(impacts) == 0 || impacts[len(impacts)-1].Fatal {
		return
	}
	var damage, aggression uint32
	for _, impact := range impacts {
		damage += impact.Applied
		aggression = combat.AccumulateThreat(aggression, impact.Applied, skill.Threat)
	}
	if damage == 0 && aggression == 0 {
		return
	}
	var events []simulation.HostilityEvent
	if c := rt.findCharacterByGid(division, attacker); c != nil {
		if link, ok := rt.effects.ThreatLink(division, c.Name, now); ok {
			// Native dispatches the linked source event before the original
			// attacker's event, including a zero transfer. Never transfer HP.
			if rt.findCharacterByGid(division, link.SourceGID) != nil {
				var transferred uint32
				aggression, transferred = combat.SplitLinkedThreat(aggression, link.ThreatPercent)
				events = append(events, simulation.HostilityEvent{Attacker: link.SourceGID, Aggression: transferred})
			}
		}
	}
	events = append(events, simulation.HostilityEvent{Attacker: attacker, Damage: damage, Aggression: aggression})
	rt.recordSkillHostility(division, target, events, now)
}

func (rt *Runtime) recordSkillHostility(division string, target uint32, events []simulation.HostilityEvent, now int64) {
	instance, ok := rt.Monsters.Get(division, target)
	if !ok {
		return
	}
	mover, ok := rt.Monsters.Mover(division, target)
	if !ok {
		return
	}
	pose := mover.LivePoseAt(now, nil)
	from := simulation.Spawn{RegionID: pose.RegionID, X: pose.X, Y: pose.Y, Z: pose.Z}
	candidates := make(map[uint32]monster.OpponentCandidate)
	gids := []uint32{instance.Opponents[0].GID, instance.Opponents[1].GID}
	for _, event := range events {
		gids = append(gids, event.Attacker)
	}
	for _, gid := range gids {
		character := rt.findCharacterByGid(division, gid)
		if character == nil {
			continue
		}
		snapshot := rt.characterSnapshot(division, character)
		if snapshot == nil || snapshot.DeletePending || !enterworld.CharacterAlive(snapshot) || !monster.AllowsTargetStatus(instance.Ref.TidWord, instance.Nest.NativeTacticsFlags, snapshot.NativeBodyStatus) {
			continue
		}
		to := rt.liveSpawn(simulation.WorldKey(division, snapshot.Name), snapshot, now)
		candidates[gid] = monster.OpponentCandidate{GID: gid, Eligible: true, Distance: simulation.WorldDistance2D(from, to)}
	}
	rt.Monsters.RecordHostilitySequence(division, target, events, candidates, now)
}
