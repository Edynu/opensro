package commerce

import (
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestTaxArithmeticRoundingAndAdmission(t *testing.T) {
	for _, tc := range []struct {
		base     uint64
		percent  int16
		purchase bool
		want     uint64
	}{
		{15, 20, false, 12}, {15, 20, true, 18}, {15, -20, false, 18}, {15, -20, true, 12},
		{1, 20, false, 1}, {99, 20, false, 80}, {0, 32767, false, 0},
	} {
		got, ok := AdjustPrice(tc.base, Tax{Percent: tc.percent, Precision: 53}, tc.purchase)
		if !ok || got != tc.want {
			t.Fatalf("%+v: %d %v", tc, got, ok)
		}
	}
	if _, ok := AdjustPrice(10, Tax{Percent: 1}, false); ok {
		t.Fatal("unknown x87 precision silently guessed")
	}
	if _, ok := AdjustPrice(10, Tax{Percent: 200, Precision: 53}, false); ok {
		t.Fatal("negative gold accepted")
	}
	if _, ok := AdjustPrice(^uint64(0), Tax{}, false); ok {
		t.Fatal("unsigned input accepted as signed")
	}
}

func TestRepairOverrideFollowsTax(t *testing.T) {
	ref := &enterworld.ItemRef{TypeIDs: [4]int64{3, 1, 6, 2}, NativeFields: enterworld.NewNativeFields(map[string]float64{"sellPrice": 40})}
	defs := priceMagic{1: {OptionName: "MATTR_REPAIR"}}
	credit, restore, ok := SalePrices(ref, []uint64{1}, defs, Tax{Percent: -100, Precision: 53})
	if !ok || credit != 1 || restore != 1 {
		t.Fatal("repair override taxed", credit, restore, ok)
	}
	credit, restore, ok = SalePrices(ref, nil, defs, Tax{Percent: 20, Precision: 53})
	if !ok || credit != 32 || restore != 40 {
		t.Fatal("base-price retention floor lost", credit, restore, ok)
	}
}
