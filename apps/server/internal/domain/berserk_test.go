package domain

import (
	"encoding/json"
	"testing"
)

func TestBerserkPointOwner(t *testing.T) {
	for start := uint8(0); start <= 5; start++ {
		for delta := -8; delta <= 8; delta++ {
			for mode := uint8(0); mode < 8; mode++ {
				c := Character{BerserkPoints: start, NativeBodyStatus: mode}
				want := max(0, min(5, int(start)+delta))
				if mode == 1 && delta > 0 {
					want = int(start)
				}
				changed := c.ModifyBerserkPoints(delta)
				if int(c.BerserkPoints) != want || changed != (want != int(start)) {
					t.Fatalf("%d %d %d", start, delta, mode)
				}
			}
		}
	}
}
func TestBerserkPersistenceExcludesRuntime(t *testing.T) {
	c := Character{BerserkPoints: 4, NativeBodyStatus: 1, BerserkUntilMs: 1234}
	b, e := json.Marshal(c)
	if e != nil {
		t.Fatal(e)
	}
	var d Character
	if e = json.Unmarshal(b, &d); e != nil {
		t.Fatal(e)
	}
	if d.BerserkPoints != 4 || d.NativeBodyStatus != 0 || d.BerserkUntilMs != 0 {
		t.Fatal("invalid reentry", d)
	}
}
