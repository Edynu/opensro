package action

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/instance"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

func (rt *Runtime) characterMonster(division string, character *enterworld.Character, gid uint32) (monster.Instance, bool) {
	if character == nil || rt.Monsters == nil {
		return monster.Instance{}, false
	}
	if value, exists := rt.characterAdmissions.Load(simulation.WorldKey(division, character.Name)); exists {
		owner := value.(populationAdmission)
		if uint32(owner.lease.ID) != domain.CharacterWorldInstance(character) {
			return monster.Instance{}, false
		}
		return rt.Monsters.GetInPopulation(division, owner.lease, gid)
	}
	return rt.Monsters.GetInWorld(division, instance.ID(domain.CharacterWorldInstance(character)), gid)
}
