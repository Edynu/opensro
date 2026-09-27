package enterworld

import (
	"strconv"
	"testing"
)

func TestSetvStrideAndWholeProgramReplacement(t *testing.T) {
	// The auxiliary word deliberately equals a known buff marker. It remains
	// an argument and must not become an independently executed cbuf block.
	f := criticalFields("1936028790", "1160926017", "20", "1667396966", "1734702198", "1160926017")
	if encodedTailContainsTag(f, 0x63627566) {
		t.Fatal("setv argument became cbuf")
	}
	if !encodedAttackParameters(f).Has(ParameterTwoHandPower) {
		t.Fatal("lost following getv")
	}
	makeFields := func(tail ...string) []string {
		f := criticalFields(tail...)
		for len(f) < 118 { // a shipped row's full width
			f = append(f, "0")
		}
		f[68] = "4"
		return f
	}
	f = makeFields("1936028790", "1160926017", "20", "0", "1936028790", "1160926017", "35", "0", "1936028790", "1179205972", "50", "0")
	got := encodedPassiveParameters(f)
	if !got.Pinned || got.Values[ParameterTwoHandPower] != 35 || got.Values[ParameterFirePower] != 50 {
		t.Fatalf("%+v", got)
	}
	copy(f[81:], []string{"1936028790", "999999", "10", "0"})
	if encodedPassiveParameters(f).Pinned {
		t.Fatal("partial unknown parameter program activated")
	}
	tail := []string{}
	for i := 0; i < 6; i++ {
		tail = append(tail, "1936028790", "1160926017", strconv.Itoa(i), "0")
	}
	if encodedPassiveParameters(makeFields(tail...)).Pinned {
		t.Fatal("more than five setv records admitted")
	}
}

func TestOffenseRequiresEveryGetvConsumer(t *testing.T) {
	for _, unknown := range []bool{false, true} {
		f := make([]string, 118)
		for i := range f {
			f[i] = "0"
		}
		f[0] = "1"
		copy(f[69:], []string{"6386804", "4", "100", "10", "10", "0", "1734702198", "1160860481", "1734702198", "1145522258"})
		if unknown {
			f[78] = "999999"
		}
		r := SkillRow{CombatPinned: true, TimingPinned: true, ActionRangePinned: true, TargetRequired: true}
		parseSkillOffense(f, &r)
		if r.DirectOffensePinned == unknown {
			t.Fatalf("unknown=%v admitted=%v", unknown, r.DirectOffensePinned)
		}
	}
}

func TestAdjacentNativeParameterStrides(t *testing.T) {
	for _, tc := range []struct {
		tag   uint32
		arity int
	}{{0x73617073, 2}, {0x73746e73, 3}, {0x73657476, 3}} {
		if got := spawnParamArity(tc.tag); got != tc.arity {
			t.Fatalf("%x arity%d want%d", tc.tag, got, tc.arity)
		}
	}
}
