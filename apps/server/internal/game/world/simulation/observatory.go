package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"sort"
)

type ObservatoryMonster struct {
	GID    uint32  `json:"gid"`
	Ref    uint32  `json:"ref"`
	Name   string  `json:"name"`
	Level  uint8   `json:"level"`
	Rarity uint8   `json:"rarity"`
	HP     uint32  `json:"hp"`
	MaxHP  uint32  `json:"maxHp"`
	Region uint16  `json:"region"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	Mode   string  `json:"mode"`
	Target uint32  `json:"target"`
}
type ObservatoryPopulation struct {
	Monsters  []ObservatoryMonster `json:"monsters"`
	Resident  int                  `json:"resident"`
	Regions   int                  `json:"regions"`
	Nests     int                  `json:"nests"`
	Respawns  int                  `json:"respawns"`
	Truncated bool                 `json:"truncated"`
}

// Copies only existing state under its owner lock. Never calls division(),
// materialization, timers, RNG or notice drains. Sorting occurs after unlocking.
func (s *MonsterState) Observatory(division string) ObservatoryPopulation {
	out := ObservatoryPopulation{Monsters: []ObservatoryMonster{}, Nests: len(s.template.Nests)}
	s.mu.Lock()
	if state := s.divs[division]; state != nil {
		out.Resident = state.instances.len()
		out.Regions = len(state.materialized)
		out.Respawns = state.pendingRefills()
		now := s.nowMillis()
		for gid := range state.instances.ids() {
			if len(out.Monsters) >= 50000 {
				out.Truncated = true
				break
			}
			ref, rarity, hp, maxHP := state.instances.projection(gid)
			pose := monster.Pose{}
			mode := "idle"
			var target uint32
			if mover, ok := state.movers.lookup(gid); ok {
				pose = mover.LivePoseAt(now, nil)
				mode = mover.Mode().String()
				target = mover.TargetGID()
			} else {
				actor := state.instances.get(gid)
				pose = monster.Pose{RegionID: actor.Spawn.RegionID, X: actor.Spawn.X, Y: actor.Spawn.Y, Z: actor.Spawn.Z}
			}
			out.Monsters = append(out.Monsters, ObservatoryMonster{GID: gid, Ref: ref.RefObjID, Name: ref.Name, Level: ref.Level, Rarity: rarity, HP: hp, MaxHP: maxHP, Region: pose.RegionID, X: pose.X, Y: pose.Y, Z: pose.Z, Mode: mode, Target: target})
		}
	}
	s.mu.Unlock()
	sort.Slice(out.Monsters, func(i, j int) bool { return out.Monsters[i].GID < out.Monsters[j].GID })
	return out
}
