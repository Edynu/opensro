package commerce

import (
	"math"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

type priceMagic map[uint32]*enterworld.MagicOptionRow

func (m priceMagic) MagicOptionByParamID(id uint32) (*enterworld.MagicOptionRow, bool) {
	r, ok := m[id]
	return r, ok
}

func TestNativeSaleRepairPriceBranches(t *testing.T) {
	ref := &enterworld.ItemRef{TypeIDs: [4]int64{3, 1, 6, 2}, NativeFields: enterworld.NewNativeFields(map[string]float64{"sellPrice": 40})}
	defs := priceMagic{1: {OptionName: "MATTR_REPAIR"}, 2: {OptionName: "MATTR_NOT_REPARABLE", ParamName: "-"}, 3: {OptionName: "MATTR_NOT_REPARABLE", ParamName: "value"}}
	for _, tc := range []struct {
		magic []uint64
		want  uint64
	}{
		{nil, 40}, {[]uint64{1}, 1}, {[]uint64{1<<32 | 1}, 1}, {[]uint64{2<<32 | 1}, 40}, {[]uint64{0xffffffff00000001}, 40}, {[]uint64{2}, 1}, {[]uint64{3}, 40}, {[]uint64{99}, 40},
	} {
		got, ok := SaleUnitPrice(ref, tc.magic, defs)
		if !ok || got != tc.want {
			t.Fatalf("%v: got %d/%v want %d", tc.magic, got, ok, tc.want)
		}
	}
	if _, ok := SaleUnitPrice(ref, []uint64{1}, nil); ok {
		t.Fatal("missing metadata accepted")
	}
	ref.TypeIDs = [4]int64{3, 3, 1, 1}
	if got, ok := SaleUnitPrice(ref, []uint64{1}, defs); !ok || got != 40 {
		t.Fatal("equipment restriction leaked into expendables")
	}
	for _, price := range []float64{-1, 1.5, math.NaN(), math.Inf(1), 2147483648} {
		ref.NativeFields = ref.NativeFields.With("sellPrice", price)
		if _, ok := SaleUnitPrice(ref, nil, defs); ok {
			t.Fatalf("invalid signed price %v", price)
		}
	}
	ref.NativeFields = ref.NativeFields.With("sellPrice", 0)
	if got, ok := SaleUnitPrice(ref, nil, defs); !ok || got != 0 {
		t.Fatal("native zero price refused")
	}
}
