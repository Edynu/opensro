package action

import (
	"fmt"

	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/instance"
	"opensro.online/server/internal/game/world/simulation"
)

// The authenticated transport owns a membership in one allocated lifetime.
// A persisted packed ID is only an admission request, never a live lease.
type populationAdmission struct {
	session        uint64
	gid            uint32
	lease          instance.Lease
	division, name string
	region         uint16
	regionBound    bool
}

func (rt *Runtime) admitPopulationSession(division, name string, session uint64) error {
	c := rt.characterSnapshot(division, rt.findCharacter(division, name))
	if c == nil || session == 0 || rt.Monsters == nil {
		return fmt.Errorf("missing actor, session or population authority")
	}
	rt.Monsters.StartDivision(division)
	id := instance.ID(domain.CharacterWorldInstance(c))
	lease, exists := rt.Monsters.PopulationLease(division, id)
	if !exists {
		return fmt.Errorf("world %08x is not allocated", uint32(id))
	}
	key := simulation.WorldKey(division, name)
	gid := enterworld.ObjectIDForCharacter(c)
	if previous, exists := rt.characterAdmissions.Load(key); exists {
		owner := previous.(populationAdmission)
		if owner.lease != lease || owner.gid != gid {
			return fmt.Errorf("world transfer requires retiring the previous membership")
		}
		// Replacing the socket does not insert a second PC or recheck capacity.
		owner.session = session
		rt.characterAdmissions.Store(key, owner)
		return nil
	}
	if status := rt.Monsters.AdmitPopulationPC(division, lease, gid, c.GMPrivilege); status != instance.Success {
		return fmt.Errorf("world %08x refused membership (native status %d)", uint32(id), status)
	}
	rt.characterAdmissions.Store(key, populationAdmission{session: session, gid: gid, lease: lease, division: division, name: name})
	rt.bindResidentRegion(key, rt.Now().UnixMilli())
	return nil
}

func (rt *Runtime) leavePopulationSession(division, name string) {
	previous, exists := rt.characterAdmissions.LoadAndDelete(simulation.WorldKey(division, name))
	if !exists || rt.Monsters == nil {
		return
	}
	owner := previous.(populationAdmission)
	rt.Monsters.LeavePopulationPC(division, owner.lease, owner.gid)
}

func (rt *Runtime) CharacterPopulationLease(division, name string, session uint64) (instance.Lease, bool) {
	value, exists := rt.characterAdmissions.Load(simulation.WorldKey(division, name))
	if !exists {
		return instance.Lease{}, false
	}
	owner := value.(populationAdmission)
	if owner.session != session || rt.Monsters == nil {
		return instance.Lease{}, false
	}
	current, exists := rt.Monsters.PopulationLease(division, owner.lease.ID)
	return owner.lease, exists && current == owner.lease
}

func (rt *Runtime) EntryPopulationLease(division, name string) (instance.Lease, bool) {
	value, exists := rt.characterAdmissions.Load(simulation.WorldKey(division, name))
	if !exists {
		return instance.Lease{}, false
	}
	owner := value.(populationAdmission)
	return rt.CharacterPopulationLease(division, name, owner.session)
}
