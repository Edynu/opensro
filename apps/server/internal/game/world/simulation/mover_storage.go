package simulation

import (
	"iter"
	"math"
	"opensro.online/server/internal/game/world/monster"
	"unique"
)

// Only the population owner writes these records. Pending values discard only
// completed navigation caches; expanding a snapshot never creates a new actor.
type moverRecord struct {
	live    *monster.MoverState
	pending *residentPendingMover
}

// Positions and activity clocks remain per actor. All other immutable pending
// fields commonly repeat across thousands of actors; handles share those values
// without sharing mutable state. Float speed bits preserve signed zero exactly.
type pendingMoverShared struct {
	row       monster.PendingMover
	speedBits uint64
}
type residentPendingMover struct {
	pose     monster.Pose
	activity monster.ActivityCadence
	shared   unique.Handle[pendingMoverShared]
}

func (p *residentPendingMover) set(row monster.PendingMover) {
	p.pose, p.activity = row.Pose, row.Activity
	shared := pendingMoverShared{row: row, speedBits: math.Float64bits(row.NavigationSpeed)}
	shared.row.Pose = monster.Pose{}
	shared.row.Activity = monster.ActivityCadence{}
	shared.row.NavigationSpeed = 0
	if p.shared == (unique.Handle[pendingMoverShared]{}) || p.shared.Value() != shared {
		p.shared = unique.Make(shared)
	}
}
func (p *residentPendingMover) value() monster.MoverState {
	shared := p.shared.Value()
	row := shared.row
	row.Pose, row.Activity = p.pose, p.activity
	row.NavigationSpeed = math.Float64frombits(shared.speedBits)
	return row.Expand()
}

type moverStorage map[uint32]moverRecord

func newMoverStorage(rows map[uint32]monster.MoverState) moverStorage {
	s := make(moverStorage, len(rows))
	for gid, row := range rows {
		s.set(gid, row)
	}
	return s
}
func (s moverStorage) set(gid uint32, row monster.MoverState) {
	old := s[gid]
	if p, ok := row.PendingSnapshot(); ok {
		if old.pending != nil {
			old.pending.set(p)
			return
		}
		resident := &residentPendingMover{}
		resident.set(p)
		s[gid] = moverRecord{pending: resident}
		return
	}
	if old.live != nil {
		*old.live = row
		return
	}
	live := new(monster.MoverState)
	*live = row
	s[gid] = moverRecord{live: live}
}
func (r moverRecord) value() monster.MoverState {
	if r.live != nil {
		return *r.live
	}
	if r.pending != nil {
		return r.pending.value()
	}
	return monster.MoverState{}
}
func (s moverStorage) lookup(gid uint32) (monster.MoverState, bool) {
	r, ok := s[gid]
	return r.value(), ok
}
func (s moverStorage) get(gid uint32) monster.MoverState { return s[gid].value() }
func (s moverStorage) values() iter.Seq2[uint32, monster.MoverState] {
	return func(yield func(uint32, monster.MoverState) bool) {
		for gid, r := range s {
			if !yield(gid, r.value()) {
				return
			}
		}
	}
}
