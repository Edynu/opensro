package statuseffect

import "testing"

func TestRetireEventIgnoresVoluntaryProtectionAndPreservesOtherMasks(t *testing.T) {
	r := NewRegistry()
	for i, mask := range []uint8{0, 1, 2, 4, 7} {
		e := movementFixture(uint32(i+1), MovementIndependent, 20)
		e.EventCancelMask = mask
		e.ClientCancelable = false
		if !r.Apply(e) {
			t.Fatal("apply")
		}
	}
	ended := r.RetireEvent("d", "runner", 4)
	if len(ended) != 2 || ended[0].InstanceToken != 4 || ended[1].InstanceToken != 5 {
		t.Fatalf("ended %+v", ended)
	}
	if len(r.RetireEvent("d", "runner", 4)) != 0 || len(r.Snapshot("d", "runner")) != 3 {
		t.Fatal("non-idempotent event")
	}
}
