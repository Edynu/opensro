package combat

import "testing"

func TestKnockdownChanceRankAndClamp(t *testing.T) {
	for _, c := range []struct {
		rank, chance uint32
		level, want  uint8
	}{
		{19, 50, 19, 50}, {19, 50, 1, 75}, {19, 50, 60, 24},
		{0, 50, 1, 0}, {19, 0, 19, 0}, {0xffffffff, 50, 1, 75},
	} {
		if got := KnockdownChance(c.rank, c.chance, c.level); got != c.want {
			t.Fatalf("%+v: %d", c, got)
		}
	}
}
