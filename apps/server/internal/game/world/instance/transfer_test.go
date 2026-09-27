package instance

import "testing"

func TestTransferPreflightDoesNotAllocateOrAdmit(t *testing.T) {
	r := NewRegistry([]Definition{{ID: 1, LayerLimit: 1}, {ID: 2, LayerLimit: 2, PlayerLimit: 1}})
	for _, row := range []struct {
		id     ID
		bypass bool
		want   Status
	}{
		{Pack(0, 1), false, InvalidLayer}, {Pack(1, 0), false, InvalidLayer},
		{Pack(99, 1), false, MissingWorld}, {Pack(1, 1), false, Success},
		{Pack(2, 1), false, MissingLayer}, {Pack(2, 1), true, MissingLayer},
		{Pack(2, 3), false, MissingLayer},
	} {
		if got := r.CheckTransfer(row.id, row.bypass); got != row.want {
			t.Fatalf("%08x: %d != %d", row.id, got, row.want)
		}
		if _, exists := r.Lookup(row.id); exists {
			t.Fatal("preflight allocated")
		}
	}
	lease, _ := r.Allocate(Pack(2, 1))
	if got := r.CheckTransfer(lease.ID, false); got != Success {
		t.Fatal(got)
	}
	if got := r.AdmitPC(lease, 7, false); got != Success {
		t.Fatal("preflight changed membership", got)
	}
	if got := r.CheckTransfer(lease.ID, false); got != PlayerLimitReached {
		t.Fatal(got)
	}
	if got := r.CheckTransfer(lease.ID, true); got != Success {
		t.Fatal(got)
	}
	if got := r.AdmitPC(lease, 7, true); got != AlreadyMember {
		t.Fatal("request must not erase duplicate membership", got)
	}
}
