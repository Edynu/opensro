package simulation

import (
	"container/heap"
	"testing"
	"time"
)

func TestSparseQueueCompactionPreservesIdentityAndOrder(t *testing.T) {
	var state divisionMonsterState
	for i := uint32(0); i < 10000; i++ {
		state.behavior.set(i, int64(i%17))
	}
	state.compactDormantIndexes(time.Now().Add(time.Second))
	for i := uint32(0); i < 9990; i++ {
		state.behavior.remove(i)
	}
	before := state.behavior.byGID[9999]
	state.compactDormantIndexes(time.Now().Add(time.Second))
	if state.behavior.byGID[9999] != before || cap(state.behavior.entries) > 32 || state.sparseMapPeaks[2] != 10 {
		t.Fatal("queue contraction did not preserve entry identity")
	}
	lastAt, lastGid := int64(-1), uint32(0)
	for state.behavior.Len() > 0 {
		e := heap.Pop(&state.behavior).(*behaviorEntry)
		if e.at < lastAt || e.at == lastAt && e.gid < lastGid {
			t.Fatal("priority order changed")
		}
		lastAt, lastGid = e.at, e.gid
	}
	if len(state.behavior.byGID) != 0 {
		t.Fatal("index not synchronized")
	}
}

func TestSparseMapWaitsForAdmission(t *testing.T) {
	m := map[uint32]int{7: 99}
	peak := 10000
	got := compactSparseMap(m, &peak, false)
	got[8] = 100
	if m[8] != 100 || peak != 10000 {
		t.Fatal("compaction ran without admission")
	}
	got = compactSparseMap(m, &peak, true)
	if len(got) != 2 || got[7] != 99 || got[8] != 100 || peak != 2 {
		t.Fatal("map contraction lost state")
	}
	delete(m, 7)
	if got[7] != 99 {
		t.Fatal("old backing table retained")
	}
}

func BenchmarkSparseMapContraction(b *testing.B) {
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		m := make(map[uint32]*behaviorEntry, 53000)
		for gid := uint32(0); gid < 53000; gid++ {
			m[gid] = &behaviorEntry{gid: gid}
		}
		for gid := uint32(0); gid < 51000; gid++ {
			delete(m, gid)
		}
		peak := 53000
		b.StartTimer()
		m = compactSparseMap(m, &peak, true)
		if len(m) != 2000 {
			b.Fatal("lost live entries")
		}
	}
}
