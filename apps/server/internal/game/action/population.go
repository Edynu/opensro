package action

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

// PopulationPlayers snapshots present PCs at their live position. It does not
// apply the reward distributor's alive filter to native message-cell counts.
func (rt *Runtime) PopulationPlayers(division string, now int64) []simulation.PopulationPlayer {
	var out []simulation.PopulationPlayer
	rt.deps.Read(division, func() {
		for _, c := range rt.deps.CharactersForDivision(division) {
			if c == nil || c.DeletePending || rt.RewardActorPresent == nil || !rt.RewardActorPresent(division, c.Name) {
				continue
			}
			out = append(out, simulation.PopulationPlayer{GID: enterworld.ObjectIDForCharacter(c), World: domain.CharacterWorldInstance(c), Spawn: rt.liveSpawn(simulation.WorldKey(division, c.Name), c, now)})
		}
	})
	return out
}
