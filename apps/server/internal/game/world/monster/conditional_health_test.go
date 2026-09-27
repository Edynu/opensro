package monster

import "testing"

func TestConditionalHealthNativeBoundaries(t *testing.T) {
	for _, tc := range []struct {
		hp, max, threshold uint32
		want               bool
	}{
		{60, 100, 60, true}, {61, 100, 60, false}, {50, 100, 50, true}, {40, 100, 40, true},
		{0, 0, 60, false}, {1, 0, 60, false}, {0, 100, 0, true},
		{2147483647, 2147483646, 100, true}, // float32 spill, not real-number fraction
		{0xffffffff, 100, 0, true},          // native signed HP virtual accessor
	} {
		if got := ConditionalHealthEligible(tc.hp, tc.max, tc.threshold); got != tc.want {
			t.Fatalf("%+v: %v", tc, got)
		}
	}
}
