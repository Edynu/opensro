package grounditem

import (
	"encoding/json"
	"opensro.online/server/internal/domain"
	"testing"
)

func TestGroundPopulationIsolationAndRetirement(t *testing.T) {
	r := NewRegistry()
	a, b := Population{0x1000a, 2}, Population{0x1000a, 3}
	old := r.Add("a", Item{Population: a})
	next := r.Add("a", Item{Population: b})
	main := r.Add("a", Item{})
	for _, p := range []Population{b, {}} {
		if _, ok := r.GetInPopulation("a", p, old.Gid); ok {
			t.Fatal("cross-population lookup")
		}
	}
	if _, ok := r.GetInPopulation("b", a, old.Gid); ok {
		t.Fatal("cross-division lookup")
	}
	if got := r.RemovePopulation("a", a); len(got) != 1 || got[0].Gid != old.Gid {
		t.Fatal(got)
	}
	for _, gid := range []uint32{next.Gid, main.Gid} {
		if _, ok := r.Get("a", gid); !ok {
			t.Fatal("retired another lifetime")
		}
	}
	if got := r.Add("a", Item{Population: Population{World: 0x1000a}}); got.Gid != 0 {
		t.Fatal("accepted missing generation")
	}
}

func TestGroundPersistenceKeepsOptionsButNotRetiredWorlds(t *testing.T) {
	r := NewRegistry()
	options := []uint64{0xffffffffffffffff, 0x8000000000000001}
	main := r.Add("a", Item{MagicOptions: options})
	foreign := r.Add("a", Item{Population: Population{0x1000a, 2}})
	options[0] = 0
	main.MagicOptions[1] = 0
	snapshot := r.Snapshot()
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var persisted domain.GroundSnapshot
	if err = json.Unmarshal(data, &persisted); err != nil {
		t.Fatal(err)
	}
	persisted.GidCounter = 0 // even a stale watermark must not reuse retired GIDs
	fresh := NewRegistry()
	fresh.Restore(persisted)
	got, ok := fresh.Get("a", main.Gid)
	if !ok || got.MagicOptions[0] != 0xffffffffffffffff || got.MagicOptions[1] != 0x8000000000000001 {
		t.Fatal(got)
	}
	got.MagicOptions[0] = 0
	again, _ := fresh.Get("a", main.Gid)
	if again.MagicOptions[0] == 0 {
		t.Fatal("read escaped registry ownership")
	}
	if _, ok := fresh.Get("a", foreign.Gid); ok {
		t.Fatal("resurrected foreign population")
	}
	if next := fresh.Add("a", Item{}); next.Gid <= foreign.Gid {
		t.Fatal("reused retired gid")
	}
}
