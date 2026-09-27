package combat

import (
	"math"
	"testing"

	"opensro.online/server/internal/game/enterworld"
)

func TestCriticalModifierNativeByteArithmetic(t *testing.T) {
	for _, tc := range []struct {
		name          string
		base          float64
		flat, percent uint32
		want          uint8
	}{
		{"authored bow", 3, 20, 0, 23},
		{"authored monster", 2, 10, 0, 12},
		{"truncate base before percentage; flat after", 7.9, 20, 150, 37},
		{"percentage adds to base", 20, 0, 50, 30},
		{"flat does not scale", 0, 20, 150, 20},
		{"flat low byte", 3, 276, 0, 23},
		{"base low byte", 259.9, 20, 100, 26},
		{"wrap above 255", 250, 10, 0, 4},
		{"wrap to zero", 250, 6, 0, 0},
		{"bonus truncation precedes byte wrap", 255, 1, 150, 126},
		{"unsigned percentage", 1, 0, 0xffffffff, 41},
		{"FISTP overflow low byte is zero", 255, 1, 0xffffffff, 0},
		{"divide then multiply; 53-bit rounding", 100, 0, 57, 156},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := EffectiveCriticalRate(tc.base, enterworld.SkillCriticalModifier{Present: true, Flat: tc.flat, Percent: tc.percent})
			if err != nil || got != tc.want {
				t.Fatalf("rate=%d err=%v, want %d", got, err, tc.want)
			}
		})
	}
	for _, base := range []float64{-1, math.NaN(), math.Inf(1), float64(math.MaxInt32) + 1} {
		if _, err := EffectiveCriticalRate(base, enterworld.SkillCriticalModifier{}); err == nil {
			t.Fatalf("accepted invalid base %v", base)
		}
	}
	if got, err := EffectiveCriticalRate(259.9, enterworld.SkillCriticalModifier{Flat: 100}); err != nil || got != 3 {
		t.Fatal("absent block must ignore its words")
	}
}

func TestCriticalModifierShortcutsAndRetainedAccumulator(t *testing.T) {
	previous := Probability{Initialized: true, Threshold: -40}
	for _, tc := range []struct {
		flat uint32
		want bool
	}{{97, true}, {253, false}} {
		rate, _ := EffectiveCriticalRate(3, enterworld.SkillCriticalModifier{Present: true, Flat: tc.flat})
		got, next, err := CriticalOutcome(float64(rate), previous, func() (uint32, error) { t.Fatal("shortcut consumed RNG"); return 0, nil })
		if err != nil || got != tc.want || next != previous {
			t.Fatalf("shortcut %d: %v %+v %v", rate, got, next, err)
		}
	}
	// Changing a modifier changes the increment, not the already accumulated
	// threshold. Resetting history here would turn this miss into a critical.
	got, next, err := CriticalOutcome(23, previous, func() (uint32, error) { return 0, nil })
	if err != nil || got || next.Threshold != -17 {
		t.Fatalf("history reset: %v %+v %v", got, next, err)
	}
}
