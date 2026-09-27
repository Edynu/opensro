/*
===========================================================================

monster_storage.go - compact resident storage for monsters

===========================================================================
*/

package simulation

import (
	"iter"
	"opensro.online/server/internal/game/abnormal"
	"unique"

	"opensro.online/server/internal/game/world/monster"
)

/*
==================
residentMonster

Resident storage shares immutable catalogue values, never mutable actor state.
Only MonsterState accesses this under its population mutex. Public reads
reconstruct the existing comparable, detached Instance value.
==================
*/
type residentMonster struct {
	conditionalUsed     uint8
	ref                 unique.Handle[monster.MonsterRef]
	nest                unique.Handle[monster.NestRow]
	help                monster.HelpInbox
	motion              monster.MotionHold
	spawn               monster.SpawnPoint
	nestDetached        bool
	spawnHeading        uint16
	currentHP           uint32
	damageSinceSummon   uint32
	lastSummonCommandMs uint32
	opponents           [2]monster.Opponent
	summonActionUntilMs int64
	summonerGID         uint32
	summonSightRange    float64
	summonerFollowRange float64
}

type monsterStorage struct {
	selfEffects map[uint32]monster.SelfEffects
	hot         map[uint32]residentMonster
	abnormal    map[uint32]*abnormal.Block // immutable non-nil blocks
	cold        map[uint32]archivedMonster
	archive     *monsterArchive
}

func newMonsterStorage(rows map[uint32]monster.Instance) monsterStorage {
	s := monsterStorage{hot: make(map[uint32]residentMonster, len(rows))}
	for gid, row := range rows {
		s.set(gid, row)
	}
	return s
}

func (s *monsterStorage) set(gid uint32, row monster.Instance) {
	if row.SelfEffects != (monster.SelfEffects{}) {
		if s.selfEffects == nil {
			s.selfEffects = make(map[uint32]monster.SelfEffects)
		}
		s.selfEffects[gid] = row.SelfEffects
	} else {
		delete(s.selfEffects, gid)
	}
	if s.hot == nil {
		s.hot = make(map[uint32]residentMonster)
	}
	s.removeCold(gid)
	if row.Abnormal != nil {
		if s.abnormal == nil {
			s.abnormal = make(map[uint32]*abnormal.Block)
		}
		s.abnormal[gid] = row.Abnormal
	} else {
		delete(s.abnormal, gid)
	}
	old, exists := s.hot[gid]
	ref, nest := old.ref, old.nest
	if !exists || ref.Value() != row.Ref {
		ref = unique.Make(row.Ref)
	}
	if !exists || nest.Value() != row.Nest {
		nest = unique.Make(row.Nest)
	}
	s.hot[gid] = residentMonster{row.ConditionalUsed, ref, nest, row.Help, row.Motion, row.Spawn,
		row.NestDetached, row.SpawnHeading, row.CurrentHP, row.DamageSinceSummon, row.LastSummonCommandMs,
		row.Opponents, row.SummonActionUntilMs, row.SummonerGID,
		row.SummonSightRange, row.SummonerFollowRange}
}

func (r residentMonster) value(gid uint32) monster.Instance {
	return monster.Instance{ConditionalUsed: r.conditionalUsed, Gid: gid, Ref: r.ref.Value(), Nest: r.nest.Value(), Help: r.help,
		Motion: r.motion, Spawn: r.spawn, NestDetached: r.nestDetached,
		SpawnHeading: r.spawnHeading, CurrentHP: r.currentHP, DamageSinceSummon: r.damageSinceSummon,
		LastSummonCommandMs: r.lastSummonCommandMs,
		Opponents:           r.opponents, SummonActionUntilMs: r.summonActionUntilMs, SummonerGID: r.summonerGID,
		SummonSightRange: r.summonSightRange, SummonerFollowRange: r.summonerFollowRange}
}

func (s *monsterStorage) hotValue(gid uint32, r residentMonster) monster.Instance {
	row := r.value(gid)
	row.Abnormal = s.abnormal[gid]
	row.SelfEffects = s.selfEffects[gid]
	return row
}
func (s *monsterStorage) lookup(gid uint32) (monster.Instance, bool) {
	row, ok := s.hot[gid]
	if !ok {
		if r, exists := s.cold[gid]; exists {
			return s.archive.get(gid, r), true
		}
		return monster.Instance{}, false
	}
	return s.hotValue(gid, row), true
}

func (s *monsterStorage) get(gid uint32) monster.Instance {
	row, _ := s.lookup(gid)
	return row
}

func (s *monsterStorage) values() iter.Seq2[uint32, monster.Instance] {
	return func(yield func(uint32, monster.Instance) bool) {
		for gid, row := range s.hot {
			if !yield(gid, s.hotValue(gid, row)) {
				return
			}
		}
		for gid, r := range s.cold {
			if !yield(gid, s.archive.get(gid, r)) {
				return
			}
		}
	}
}

func (s *monsterStorage) len() int { return len(s.hot) + len(s.cold) }
func (s *monsterStorage) contains(gid uint32) bool {
	_, hot := s.hot[gid]
	_, cold := s.cold[gid]
	return hot || cold
}
func (s *monsterStorage) removeCold(gid uint32) {
	if r, ok := s.cold[gid]; ok {
		s.archive.free = append(s.archive.free, r.slot)
		delete(s.cold, gid)
	}
}
func (s *monsterStorage) remove(gid uint32) {
	delete(s.selfEffects, gid)
	delete(s.hot, gid)
	delete(s.abnormal, gid)
	s.removeCold(gid)
}
func (s *monsterStorage) release() {
	for gid := range s.cold {
		s.removeCold(gid)
	}
}
func (s *monsterStorage) wake(gid uint32) {
	if r, ok := s.cold[gid]; ok {
		row := s.archive.get(gid, r)
		s.set(gid, row)
	}
}
func (s *monsterStorage) freeze(gid uint32) {
	if s.selfEffects[gid] != (monster.SelfEffects{}) {
		return
	}
	if s.archive == nil || s.abnormal[gid] != nil {
		return
	}
	row, ok := s.hot[gid]
	if !ok {
		return
	}
	if row.conditionalUsed != 0 {
		return
	}
	if r, ok := s.archive.put(row.value(gid)); ok {
		if s.cold == nil {
			s.cold = make(map[uint32]archivedMonster)
		}
		s.cold[gid] = r
		delete(s.hot, gid)
	}
}
func (s *monsterStorage) metadata(gid uint32) (uint32, float64) {
	if r, ok := s.cold[gid]; ok {
		ref := r.ref.Value()
		return ref.RefObjID, float64(ref.BodyRadius)
	}
	if r, ok := s.hot[gid]; ok {
		ref := r.ref.Value()
		return ref.RefObjID, float64(ref.BodyRadius)
	}
	return 0, 0
}

func (s *monsterStorage) ids() iter.Seq[uint32] {
	return func(yield func(uint32) bool) {
		for gid := range s.hot {
			if !yield(gid) {
				return
			}
		}
		for gid := range s.cold {
			if !yield(gid) {
				return
			}
		}
	}
}
func (s *monsterStorage) projection(gid uint32) (monster.MonsterRef, uint8, uint32, uint32) {
	if r, ok := s.cold[gid]; ok {
		return r.ref.Value(), r.rarity, r.hp, r.maxHP
	}
	row := s.get(gid)
	return row.Ref, row.Rarity(), row.CurrentHP, row.EffectiveMaxHP()
}
