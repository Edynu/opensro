package vitals

import "testing"

func TestHitDebitSignedBoundary(t *testing.T) {
	for _, tc := range []struct{ hp, damage, want uint32 }{
		{43, 0, 0}, {43, 1, 1}, {43, 43, 43}, {43, 44, 43},
		{43, 0x7fffffff, 43}, {43, 0x80000000, 0}, {43, 0xffffffff, 0}, {0, 1, 0},
	} {
		if got := HitDebit(tc.hp, tc.damage); got != tc.want {
			t.Fatalf("%+v: %d", tc, got)
		}
	}
}
