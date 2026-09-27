package instance

import "testing"

func TestLayerAllocationAdmissionAndRetirement(t *testing.T) {
	r := NewRegistry([]Definition{{ID: 10, LayerLimit: 2, PlayerLimit: 1}})
	if _, status := r.Allocate(Pack(10, 0)); status != InvalidLayer {
		t.Fatal(status)
	}
	a, status := r.Allocate(Pack(10, 2))
	if status != Success || a.ID != ID(0x2000a) {
		t.Fatal(a, status)
	}
	b, status := r.Allocate(Pack(10, 1))
	if status != Success {
		t.Fatal(status)
	}
	if _, status := r.Allocate(a.ID); status != AllocationFull {
		t.Fatal(status)
	}
	if status := r.AdmitPC(a, 42, false); status != Success {
		t.Fatal(status)
	}
	// Capacity precedes duplicate detection, including the same PC.
	if status := r.AdmitPC(a, 42, false); status != PlayerLimitReached {
		t.Fatal(status)
	}
	if status := r.AdmitPC(a, 42, true); status != AlreadyMember {
		t.Fatal(status)
	}
	if status := r.AdmitPC(a, 43, true); status != Success {
		t.Fatal(status)
	}
	if status := r.AdmitPC(b, 44, false); status != Success {
		t.Fatal(status)
	}
	residents, exists := r.BeginRetirement(a)
	if !exists || len(residents) != 2 || residents[0] != 42 || residents[1] != 43 {
		t.Fatal("evacuation roster", residents)
	}
	if status, retire := r.LeavePC(a, 42); status != Success || retire {
		t.Fatal(status, retire)
	}
	if status, retire := r.LeavePC(a, 43); status != Success || !retire {
		t.Fatal(status, retire)
	}
	if current, ok := r.Lookup(a.ID); !ok || current != a {
		t.Fatal("last leave destroyed layer")
	}
	if status, retire := r.LeavePC(a, 43); status != NotMember || retire {
		t.Fatal(status, retire)
	}
	if status, retire := r.LeavePC(b, 44); status != Success || retire {
		t.Fatal(status, retire)
	}
	if !r.Release(a) || !r.Release(b) {
		t.Fatal("release")
	}
	first := r.worlds[10].free[0]
	replacement, status := r.Allocate(a.ID)
	if status != Success || replacement == a || r.worlds[10].slots[2] != first {
		t.Fatal("pool/generation", replacement)
	}
	if r.Release(a) || r.AdmitPC(a, 45, false) != InvalidLayer {
		t.Fatal("stale lease admitted")
	}
	if status, _ := r.LeavePC(a, 45); status != MissingLayer {
		t.Fatal(status)
	}
	if current, ok := r.Lookup(a.ID); !ok || current != replacement {
		t.Fatal("stale callback retired replacement")
	}
}

func TestLayerReleaseClearsMembersAndZeroCapacityIsUnlimited(t *testing.T) {
	r := NewRegistry([]Definition{{ID: 1, LayerLimit: 1}})
	a, _ := r.Allocate(Pack(1, 1))
	for gid := uint32(1); gid <= 1000; gid++ {
		if status := r.AdmitPC(a, gid, false); status != Success {
			t.Fatal(status)
		}
	}
	r.Release(a)
	b, _ := r.Allocate(a.ID)
	if status, _ := r.LeavePC(b, 1); status != NotMember {
		t.Fatal("pooled membership survived")
	}
	if r.AdmitPC(b, 1, false) != Success {
		t.Fatal("new resident refused")
	}
}
