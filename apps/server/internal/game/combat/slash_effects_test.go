package combat

import (
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestDownAttackNativeIntegerBoundary(t *testing.T) {
	for _, tc := range []struct {
		damage   uint32
		state    uint8
		modifier enterworld.SkillDownAttack
		want     uint32
	}{
		{3, 8, enterworld.SkillDownAttack{Present: true, Percent: 150}, 4},
		{3, 0, enterworld.SkillDownAttack{Present: true, Percent: 150}, 3},
		{3, 8, enterworld.SkillDownAttack{}, 3},
		{3, 8, enterworld.SkillDownAttack{Present: true}, 0},
		{0x80000000, 8, enterworld.SkillDownAttack{Present: true, Percent: 2}, 0},
	} {
		if got := downAttackDamage(tc.damage, tc.state, tc.modifier); got != tc.want {
			t.Fatalf("%+v: got %d", tc, got)
		}
	}
}

func TestThreatAccumulatesAcrossImpactsWithoutChangingDamage(t *testing.T) {
	modifier := enterworld.SkillThreat{Present: true, Flat: 149, Percent: 150}
	first := AccumulateThreat(0, 10, modifier)
	second := AccumulateThreat(first, 10, modifier)
	if first != 174 || second != 609 {
		t.Fatalf("threat %d,%d", first, second)
	}
	if AccumulateThreat(0xffffffff, 2, enterworld.SkillThreat{}) != 1 {
		t.Fatal("lost native dword addition")
	}
	if got := AccumulateThreat(0xffffffff, 0, enterworld.SkillThreat{Present: true, Percent: 100}); got != 0xfffffffe {
		t.Fatalf("truncation got %x", got)
	}
}

func TestDownAttackScalesLanesBeforeCombining(t *testing.T) {
	attacker := Stats{Level: 1, MaxLevel: 1, Strength: 20, Intellect: 20, PhysicalAttackMin: 13, PhysicalAttackMax: 13, MagicalAttackMin: 17, MagicalAttackMax: 17}
	defender := Stats{Level: 1, MotionState: 8}
	attack := enterworld.SkillAttack{Present: true, Flags: 12, Percent: 100, DownAttack: enterworld.SkillDownAttack{Present: true, Percent: 150}}
	roll := func() (uint32, error) { return 0, nil }
	combined, err := Resolve(attacker, defender, attack, roll)
	if err != nil {
		t.Fatal(err)
	}
	attack.DownAttack = enterworld.SkillDownAttack{}
	attack.Flags = 4
	physical, err := Resolve(attacker, defender, attack, roll)
	if err != nil {
		t.Fatal(err)
	}
	attack.Flags = 8
	magical, err := Resolve(attacker, defender, attack, roll)
	if err != nil {
		t.Fatal(err)
	}
	want := physical.Damage*150/100 + magical.Damage*150/100
	if combined.Damage != want {
		t.Fatalf("combined %d, physical %d, magical %d; want %d", combined.Damage, physical.Damage, magical.Damage, want)
	}
}
