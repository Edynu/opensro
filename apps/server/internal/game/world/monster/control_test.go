package monster

import "testing"

func TestControlBindingOwnsStateButPreservesMovement(t *testing.T) {
	m := coherentMover(MoverPending)
	m.Activity = ActivityCadence{Interval: 1500, LastCheck: 99}
	m.From, m.To = Pose{X: 10}, Pose{X: 100}
	m.DepartMs, m.ArriveMs = 100, 500
	for _, mode := range []ControlMode{ControlOwned, ControlSummoned, ControlPassive} {
		before := m
		if err := m.BindController(mode, 400002); err != nil {
			t.Fatal(err)
		}
		if m.Mode() != MoverIdle || m.ControllerGID() != 400002 || m.ControlMode() != mode || m.ArriveMs != before.ArriveMs || m.From != before.From || m.To != before.To || m.Activity != before.Activity {
			t.Fatal("binding crossed movement/activity ownership")
		}
		bound := m
		if changed, err := m.ReleaseController(400003); changed || err != nil || m != bound {
			t.Fatal("foreign controller released binding")
		}
		if changed, err := m.ReleaseController(400002); !changed || err != nil {
			t.Fatal("matching controller release refused")
		}
		if m.ControllerGID() != 0 || m.ControlMode() != ControlNone || m.ArriveMs != before.ArriveMs {
			t.Fatal("release retained binding or canceled movement")
		}
	}
}

func TestControlInvalidBindingDoesNotMutate(t *testing.T) {
	m := coherentMover(MoverPending)
	for _, test := range []struct {
		mode ControlMode
		gid  uint32
	}{{ControlNone, 1}, {ControlSummoned, 0}, {4, 1}} {
		before := m
		if m.BindController(test.mode, test.gid) == nil || m != before {
			t.Fatal("invalid control mutated owner")
		}
	}
}

func TestNativeFollowCompletionUsesOwnRadiusStrictly(t *testing.T) {
	for _, distance := range []float64{55.99, 56, 56.01} {
		calls := 0
		m := NativeFollowMotion(Pose{RegionID: 25000}, Pose{RegionID: 25000, X: distance}, 6, 9, false, Pose{}, func() uint32 { calls++; return 0 })
		if m.Satisfied != (distance < 56) || (calls == 0) != m.Satisfied {
			t.Fatalf("wrong follow completion/random admission at %g: %+v calls=%d", distance, m, calls)
		}
	}
}

func TestNativeFormationUsesUnsignedAngleAndBinCenters(t *testing.T) {
	// +/-Z both have a 90-degree unsigned angle after negation. The native
	// table's 95-degree center has negative X and negative Z in both cases.
	x, z := nativeFormationDirection(0, 1)
	x2, z2 := nativeFormationDirection(0, -1)
	if x != x2 || z != z2 || x >= 0 || z >= 0 || x < -.09 || x > -.08 {
		t.Fatalf("formation table changed: %g,%g / %g,%g", x, z, x2, z2)
	}
}

func TestControlledWanderUsesLiveDirectionAndKeepsSampledDistance(t *testing.T) {
	m := WanderMotion{X: 1, Distance: 100}
	from := Pose{RegionID: 25000, X: 100, Z: 100}
	controller := from
	controller.Z += 100
	controller.Y = 10000
	biased := m.TowardController(from, controller)
	if biased.Distance != 100 || biased.X < .707 || biased.X > .708 || biased.Z != biased.X {
		t.Fatalf("wrong planar controller bias: %+v", biased)
	}
	controller = from
	controller.X -= 100
	zero := m.TowardController(from, controller)
	if zero.X != 0 || zero.Z != 0 || zero.Distance != 100 {
		t.Fatal("opposite vectors invented a fallback direction")
	}
}

func TestNativeIdleDelayDrawOrderAndDuplicatedCenter(t *testing.T) {
	for _, test := range []struct {
		a, b uint32
		want int64
	}{{0, 1999, 2001}, {1, 1999, 5999}, {0, 0, 4000}, {1, 0, 4000}, {2, 2001, 3999}} {
		values := []uint32{test.a, test.b}
		calls := 0
		got := NativeIdleDelayMs(func() uint32 { v := values[calls]; calls++; return v })
		if got != test.want || calls != 2 {
			t.Fatalf("%+v: got %d calls=%d", test, got, calls)
		}
	}
}
