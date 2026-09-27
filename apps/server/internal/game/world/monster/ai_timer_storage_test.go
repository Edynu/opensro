package monster

import (
	"math/rand"
	"testing"
	"unsafe"
)

func TestStoredAITimersExactStateAndContinuation(t *testing.T) {
	r := rand.New(rand.NewSource(123))
	ids := []AITimerID{0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11}
	for n := 0; n < 1000; n++ {
		m := *NewAITimeManager()
		for i := range m.first {
			m.first[i].LastCheckMs = r.Uint32()
			m.first[i].IntervalMs = r.Uint32()
			m.first[i].ArmedImmediate = r.Intn(2) == 0
		}
		for i := range m.second {
			m.second[i].LastCheckMs = r.Uint32()
			m.second[i].IntervalMs = r.Uint32()
			m.second[i].ArmedImmediate = r.Intn(2) == 0
		}
		m.selected.id = ids[r.Intn(len(ids))]
		m.selected.active = r.Intn(2) == 0
		stored := m.Store()
		got := stored.Restore()
		if got != m {
			t.Fatal("timer storage changed state")
		}
		other := m
		other.first[1].LastCheckMs++
		if stored.shape != other.Store().shape {
			t.Fatal("clocks prevented configuration sharing")
		}
		for _, id := range ids {
			now := r.Uint32()
			if got.CheckTimer(id, now) != m.CheckTimer(id, now) || got != m {
				t.Fatal("restored continuation diverged")
			}
		}
		original := stored.Restore()
		detached := stored.Restore()
		detached.first[0].LastCheckMs++
		if stored.Restore() != original || detached == original {
			t.Fatal("detached mutation changed stored state")
		}
	}
	if unsafe.Sizeof(StoredAITimers{}) >= unsafe.Sizeof(AITimeManager{}) {
		t.Fatal("storage did not shrink")
	}
}
