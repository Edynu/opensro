package combat

import "testing"

func TestLinkedThreatSignedTruncationAndDwordConservation(t *testing.T) {
	for _, tc := range []struct{ input, percent, transferred uint32 }{
		{101, 36, 36}, {99, 36, 35}, {0, 36, 0}, {0xffffffff, 36, 0},
		{0xffffff9b, 36, 0xffffffdc}, {100, 150, 150}, {100, 0xffffffff, 0xffffffff},
	} {
		remaining, transferred := SplitLinkedThreat(tc.input, tc.percent)
		if transferred != tc.transferred || remaining+transferred != tc.input {
			t.Fatalf("%+v: %x + %x", tc, remaining, transferred)
		}
	}
}
