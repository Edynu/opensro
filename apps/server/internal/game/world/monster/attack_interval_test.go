package monster

import "testing"

func TestNativeAttackSelectionInterval(t *testing.T) {
	for _, c := range []struct{ previous, cooldown, roll, want uint32 }{
		{0, 1000, 0, 1000}, {0, 1000, 500, 1500},
		{0, 1000, 501, 1000}, {5000, 1000, 1000, 2000},
		{20000, 1000, 2001, 1000}, {0x80000000, 1000, 501, 1000},
		{0, 0xffffffff, 1, 0},
	} {
		if got := NextAttackInterval(c.previous, c.cooldown, c.roll); got != c.want {
			t.Fatalf("%+v: got %d", c, got)
		}
	}
}
