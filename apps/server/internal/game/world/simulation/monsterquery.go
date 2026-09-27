package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"sort"
)

type MonsterPosition struct {
	GID      uint32
	RefObjID uint32
	Name     string
	HP       uint32
	Pose     monster.Pose
}

/*
==================
QueryMonsterPositions

Reads existing actors only. It must not materialize a region, create a
division, advance respawns, or consume notices or randomness.
==================
*/
func (s *MonsterState) QueryMonsterPositions(division string, ref uint32) []MonsterPosition {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []MonsterPosition{}
	state := s.divs[division]
	if state == nil {
		return out
	}
	now := s.nowMillis()
	for gid := range state.instances.ids() {
		id, _ := state.instances.metadata(gid)
		if id != ref {
			continue
		}
		reference, _, hp, _ := state.instances.projection(gid)
		if hp == 0 {
			continue
		}
		var pose monster.Pose
		if mover, ok := state.movers.lookup(gid); ok {
			pose = mover.LivePoseAt(now, nil)
		} else {
			actor := state.instances.get(gid)
			pose = monster.Pose{RegionID: actor.Spawn.RegionID, X: actor.Spawn.X, Y: actor.Spawn.Y, Z: actor.Spawn.Z}
		}
		out = append(out, MonsterPosition{GID: gid, RefObjID: ref, Name: reference.Name, HP: hp, Pose: pose})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].GID < out[j].GID })
	return out
}
