package action

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/grounditem"
	"opensro.online/server/internal/game/world/instance"
	"opensro.online/server/internal/game/world/simulation"
)

func (rt *Runtime) groundPopulation(division string, c *enterworld.Character) (grounditem.Population, bool) {
	if c == nil {
		return grounditem.Population{}, false
	}
	id := instance.ID(domain.CharacterWorldInstance(c))
	var lease instance.Lease
	if value, exists := rt.characterAdmissions.Load(simulation.WorldKey(division, c.Name)); exists {
		owner := value.(populationAdmission)
		current, live := rt.CharacterPopulationLease(division, c.Name, owner.session)
		if !live || current.ID != id {
			return grounditem.Population{}, false
		}
		lease = current
	} else {
		// The persistent main world also serves offline authority operations.
		// Foreign worlds always require an authenticated population admission.
		if id != instance.ID(domain.DefaultWorldInstance) {
			return grounditem.Population{}, false
		}
	}
	if id == instance.ID(domain.DefaultWorldInstance) {
		return grounditem.Population{}, true
	}
	return grounditem.Population{World: uint32(lease.ID), Generation: lease.Generation}, true
}

func (rt *Runtime) characterGround(division string, c *enterworld.Character, gid uint32) (grounditem.Item, bool) {
	population, ok := rt.groundPopulation(division, c)
	if !ok {
		return grounditem.Item{}, false
	}
	return rt.Ground.GetInPopulation(division, population, gid)
}

func (rt *Runtime) addCharacterGround(division string, c *enterworld.Character, item grounditem.Item) grounditem.Item {
	population, ok := rt.groundPopulation(division, c)
	if !ok {
		return grounditem.Item{}
	}
	item.Population = population
	return rt.Ground.Add(division, item)
}

func (rt *Runtime) CharacterGroundItems(division string, c *enterworld.Character) []grounditem.Item {
	population, ok := rt.groundPopulation(division, c)
	if !ok {
		return nil
	}
	return rt.Ground.AllInPopulation(division, population)
}

func (rt *Runtime) addMonsterGround(division string, gid uint32, item grounditem.Item) grounditem.Item {
	if rt.Monsters == nil {
		return grounditem.Item{}
	}
	lease, ok := rt.Monsters.ObjectPopulation(division, gid)
	if !ok {
		return grounditem.Item{}
	}
	if uint32(lease.ID) != domain.DefaultWorldInstance {
		item.Population = grounditem.Population{World: uint32(lease.ID), Generation: lease.Generation}
	} else {
		item.Population = grounditem.Population{}
	}
	return rt.Ground.Add(division, item)
}
