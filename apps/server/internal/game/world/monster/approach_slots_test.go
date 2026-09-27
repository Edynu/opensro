package monster

import (
	"math"
	"testing"
)

func TestApproachSlotsAlternatingSearch(t *testing.T) {
	var s ApproachSlots
	want := []int{0, 1, 7, 2, 6, 3, 5, 4}
	for i, w := range want {
		if got := s.Assign(uint32(i+1), 0, nil); got != w {
			t.Fatalf("member %d slot=%d want=%d", i, got, w)
		}
	}
	before := s
	if got := s.Assign(9, 0, func(uint32) bool { return true }); got != 0 || s != before {
		t.Fatal("full group was evicted or used as an attack cap")
	}
	s.Release(9)
	if s != before {
		t.Fatal("unreserved direction cleared owner")
	}
	s.Release(4)
	if s[2] != 0 {
		t.Fatal("owner not released")
	}
}

func TestApproachSlotPreemptionAndRelease(t *testing.T) {
	s := ApproachSlots{1, 2, 0, 0, 0, 0, 0, 3}
	if got := s.Assign(4, 0, func(gid uint32) bool { return gid == 3 }); got != 7 || s[7] != 4 {
		t.Fatal("moving closer candidate did not preempt minus side")
	}
	s.Release(3)
	if s[7] != 4 {
		t.Fatal("old owner cleared replacement")
	}
	// An open plus-side slot precedes a minus-side preemption.
	s = ApproachSlots{1, 0, 0, 0, 0, 0, 0, 3}
	if got := s.Assign(4, 0, func(uint32) bool { return true }); got != 1 || s[7] != 3 {
		t.Fatal("preemption preceded open plus slot")
	}
}

func TestApproachSlotsInvalidRequestsDoNotMutate(t *testing.T) {
	for _, c := range []struct {
		gid  uint32
		slot int
	}{{0, 0}, {1, -1}, {1, 8}} {
		s := ApproachSlots{3}
		before := s
		if got := s.Assign(c.gid, c.slot, nil); got != -1 || s != before {
			t.Fatal("invalid slot request mutated group")
		}
	}
}

func TestNativeApproachPreferredSlotUsesVerifiedDivisor(t *testing.T) {
	target := Pose{RegionID: 25000, X: 1000, Z: 1000}
	for _, c := range []struct {
		x, z float64
		want int
	}{{1010, 1000, 0}, {990, 1000, 1}, {1000, 1010, 0}, {1000, 990, 0}, {1000, 1000, 0}} {
		a := target
		a.X, a.Z = c.x, c.z
		if got := NativeApproachPreferredSlot(a, target); got != c.want {
			t.Fatalf("(%f,%f) -> %d want=%d", c.x, c.z, got, c.want)
		}
	}
}

func TestNativeApproachOffsetsHaveEightDirectionsAndNativeRadius(t *testing.T) {
	for i := 0; i < 8; i++ {
		x, z := NativeApproachOffset(i, 14)
		if math.Abs(math.Hypot(float64(x), float64(z))-11.2) > 0.00001 {
			t.Fatal("wrong 0.8 reach radius")
		}
		xx, zz := NativeApproachOffset((i+4)%8, 14)
		if math.Hypot(float64(x+xx), float64(z+zz)) > .00002 {
			t.Fatal("opposite approach directions do not cancel")
		}
	}
	x, z := NativeApproachOffset(0, 14)
	if math.Abs(float64(x)-10.3844595) > .00002 || math.Abs(float64(z)+4.1955938) > .00002 {
		t.Fatalf("22-degree initial vector changed: %f %f", x, z)
	}
}
