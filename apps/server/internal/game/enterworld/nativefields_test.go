package enterworld

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
)

func TestNativeFieldsPresenceBitsAndImmutableUpdates(t *testing.T) {
	values := make(map[string]float64)
	for i, key := range nativeFieldNames {
		if i%3 != 0 {
			values[key] = math.Float64frombits(uint64(i) << 40)
		}
	}
	values["canUse"] = 0
	values["sellPrice"] = math.Copysign(0, -1)
	f := NewNativeFields(values)
	for _, key := range nativeFieldNames {
		want, present := values[key]
		got, ok := f.Lookup(key)
		if present != ok || math.Float64bits(want) != math.Float64bits(got) {
			t.Fatalf("lost field %s", key)
		}
	}
	a, _ := json.Marshal(values)
	b, err := json.Marshal(f)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("wire object changed")
	}
	var decoded NativeFields
	if err := json.Unmarshal(b, &decoded); err != nil || decoded != f {
		t.Fatal("JSON roundtrip changed fields")
	}
	changed := f.With("canUse", 129).Without("sellPrice")
	if f.Get("canUse") != 0 || changed.Get("canUse") != 129 {
		t.Fatal("update mutated published source")
	}
	if _, ok := changed.Lookup("sellPrice"); ok {
		t.Fatal("absent field became zero")
	}
	if _, ok := f.With("canUse", math.NaN()).Lookup("canUse"); !ok {
		t.Fatal("invalid numeric value became absent")
	}
	if _, err := json.Marshal(f.With("canUse", math.NaN())); err == nil {
		t.Fatal("nonfinite JSON accepted")
	}
}

func BenchmarkNativeFieldsLookup(b *testing.B) {
	values := map[string]float64{"canUse": 129, "maxStack": 250, "sellPrice": 42}
	compact := NewNativeFields(values)
	b.Run("map", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if values["maxStack"] != 250 {
				b.Fatal("value")
			}
		}
	})
	b.Run("compact", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			if compact.Get("maxStack") != 250 {
				b.Fatal("value")
			}
		}
	})
}
