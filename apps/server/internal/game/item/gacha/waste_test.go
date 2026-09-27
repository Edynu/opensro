package gacha

import "testing"

func TestWastePoolNativeInclusiveBoundary(t *testing.T) {
	for _, scale := range []uint32{1, 10, 1000} {
		bands, err := prepareWastePool([]Prize{{EntryID: 1, ChancePer10000: scale}, {EntryID: 2, ChancePer10000: 3 * scale}})
		if err != nil {
			t.Fatal(err)
		}
		if bands[0].upper != 2500 || bands[1].upper != 10000 {
			t.Fatalf("scaled pool: %+v", bands)
		}
		c := &Catalog{alternateSetIDByNpc: map[uint32]uint8{17: 2}, wastePools: map[uint8][]wasteBand{2: bands}}
		counts := [2]int{}
		for sample := uint32(0); sample < 10000; sample++ {
			p, ok := c.WastePrizeForNpc(17, sample)
			if !ok {
				t.Fatalf("uncovered sample %d", sample)
			}
			want := uint32(2)
			if sample <= 2500 {
				want = 1
			}
			if p.EntryID != want {
				t.Fatalf("sample %d entry %d want %d", sample, p.EntryID, want)
			}
			counts[p.EntryID-1]++
		}
		if counts != [2]int{2501, 7499} {
			t.Fatal(counts)
		}
		if _, ok := c.WastePrizeForNpc(17, 10000); ok {
			t.Fatal("out of range sample admitted")
		}
		if _, ok := c.WastePrizeForNpc(18, 0); ok {
			t.Fatal("unmapped NPC admitted")
		}
	}
}

func TestWastePoolRejectsUnusableWeights(t *testing.T) {
	for _, pool := range [][]Prize{nil, {{ChancePer10000: 0}}, {{ChancePer10000: 1}, {ChancePer10000: 0}}} {
		if _, err := prepareWastePool(pool); err == nil {
			t.Fatalf("invalid pool admitted: %+v", pool)
		}
	}
	// The first zero boundary is a valid map key; later duplicate keys are not.
	b, err := prepareWastePool([]Prize{{EntryID: 1}, {EntryID: 2, ChancePer10000: 1}})
	if err != nil || b[0].upper != 0 || b[1].upper != 10000 {
		t.Fatalf("zero first boundary: %+v %v", b, err)
	}
}
