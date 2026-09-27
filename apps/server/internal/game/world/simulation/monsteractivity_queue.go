package simulation

import (
	"container/heap"
	"opensro.online/server/internal/game/world/monster"
	"sort"
)

// Every materialized actor has one update entry. PENDING sleeps until its
// activity deadline (or earlier movement arrival); combat events reschedule
// the same entry. No viewer ring owns actor liveness.
type behaviorEntry struct {
	gid   uint32
	at    int64
	index int
}
type behaviorQueue struct {
	entries []*behaviorEntry
	byGID   map[uint32]*behaviorEntry
}

func (q behaviorQueue) Len() int { return len(q.entries) }
func (q behaviorQueue) Less(i, j int) bool {
	a, b := q.entries[i], q.entries[j]
	return a.at < b.at || a.at == b.at && a.gid < b.gid
}
func (q behaviorQueue) Swap(i, j int) {
	q.entries[i], q.entries[j] = q.entries[j], q.entries[i]
	q.entries[i].index = i
	q.entries[j].index = j
}
func (q *behaviorQueue) Push(v any) {
	e := v.(*behaviorEntry)
	e.index = len(q.entries)
	q.entries = append(q.entries, e)
	q.byGID[e.gid] = e
}
func (q *behaviorQueue) Pop() any {
	n := len(q.entries) - 1
	e := q.entries[n]
	q.entries[n] = nil
	q.entries = q.entries[:n]
	delete(q.byGID, e.gid)
	return e
}
func (q *behaviorQueue) set(gid uint32, at int64) {
	if q.byGID == nil {
		q.byGID = make(map[uint32]*behaviorEntry)
	}
	if e := q.byGID[gid]; e != nil {
		e.at = at
		heap.Fix(q, e.index)
		return
	}
	heap.Push(q, &behaviorEntry{gid: gid, at: at})
}
func (q *behaviorQueue) remove(gid uint32) {
	if e := q.byGID[gid]; e != nil {
		heap.Remove(q, e.index)
	}
}

func (s *MonsterState) scheduleBehavior(state *divisionMonsterState, gid uint32, now int64) {
	state.forgetDormant(gid)
	m, ok := state.movers.lookup(gid)
	if !ok {
		state.behavior.remove(gid)
		return
	}
	if s.tryDormant(state, gid, m, now) {
		return
	}
	at := now + 1
	commandPending := state.instances.hot[gid].help.HasPending()
	if m.Mode() == monster.MoverPending && m.Activity.Interval != 0 && !commandPending {
		elapsed := uint32(now) - m.Activity.LastCheck
		if elapsed <= uint32(m.Activity.Interval) {
			at = now + int64(uint32(m.Activity.Interval)-elapsed) + 1
		}
		if m.ArriveMs > now && m.ArriveMs < at {
			at = m.ArriveMs
		}
	}
	state.behavior.set(gid, at)
}

type behaviorBatch struct {
	key    populationKey
	actors []uint32
}

// Dispatch reads do not advance clocks; the due queue already applied the
// tick's summon deadline. A retired population or actor is simply absent.
func (s *MonsterState) behaviorActor(key populationKey, gid uint32) (monster.Instance, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.populationForLease(key.division, key.lease)
	if state == nil {
		return monster.Instance{}, false
	}
	actor, ok := state.instances.lookup(gid)
	return actor, ok
}

func (s *MonsterState) behaviorBatches(now int64) []behaviorBatch {
	return s.behaviorBatchesForDivision(now, "")
}
func (s *MonsterState) behaviorBatchesForDivision(now int64, division string) []behaviorBatch {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []behaviorBatch
	for _, key := range s.populationKeys() {
		if division != "" && key.division != division {
			continue
		}
		state := s.populationForLease(key.division, key.lease)
		batch := behaviorBatch{key: key}
		for state.behavior.Len() > 0 && state.behavior.entries[0].at <= now {
			// Reschedule the existing queue entry in place. Pop followed by
			// set allocated a new object for every actor on every due tick.
			e := state.behavior.entries[0]
			i, exists := state.instances.hot[e.gid]
			if !exists {
				state.behavior.remove(e.gid)
				continue
			}
			if i.currentHP == 0 && i.ref.Value().MaxHP > 0 {
				state.behavior.remove(e.gid)
				continue
			}
			if i.summonActionUntilMs != 0 && now >= i.summonActionUntilMs {
				state.instances.set(e.gid, finishSummonAction(i.value(e.gid), now))
			}
			batch.actors = append(batch.actors, e.gid)
			s.scheduleBehavior(state, e.gid, now)
		}
		sort.Slice(batch.actors, func(i, j int) bool { return batch.actors[i] < batch.actors[j] })
		out = append(out, batch)
	}
	return out
}

func (s *MonsterState) behaviorDivisions() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := make(map[string]bool)
	for _, key := range s.populationKeys() {
		seen[key.division] = true
	}
	out := make([]string, 0, len(seen))
	for key := range seen {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}
