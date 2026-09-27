/*
===========================================================================

vitals_test.go - tests for vitals.go

===========================================================================
*/

package charactervitals

import (
	"testing"

	"opensro.online/server/internal/domain"
)

func vitalTestInt64(value int64) *int64 { return &value }

func TestAbsentCurrentVitalsMeanFullWithoutMaterializingState(t *testing.T) {
	character := &domain.Character{
		Level:     vitalTestInt64(1),
		Strength:  vitalTestInt64(20),
		Intellect: vitalTestInt64(20),
		CurrentHP: nil,
		CurrentMP: nil,
	}

	if got := CurrentHP(character); got != 200 {
		t.Fatalf("CurrentHP = %d, want full derived HP 200", got)
	}
	if got := CurrentMP(character); got != 200 {
		t.Fatalf("CurrentMP = %d, want full derived MP 200", got)
	}
	if !Alive(character) {
		t.Fatal("a fresh character with an absent currentHp must be alive")
	}
	if character.CurrentHP != nil || character.CurrentMP != nil {
		t.Fatal("semantic reads must not materialize compact persisted vitals")
	}
}

func TestExplicitCurrentVitalsClampAndDriveLifeState(t *testing.T) {
	character := &domain.Character{
		Level:     vitalTestInt64(1),
		Strength:  vitalTestInt64(20),
		Intellect: vitalTestInt64(20),
		CurrentHP: vitalTestInt64(999),
		CurrentMP: vitalTestInt64(-1),
	}
	// The stored current is a plain number. The closed form is not the
	// living maximum (keeper params 3/4 are), so a stored value above it
	// is kept. Negatives still become 0.
	if got := CurrentHP(character); got != 999 {
		t.Fatalf("over-max CurrentHP = %d, want stored 999", got)
	}
	if got := CurrentMP(character); got != 0 {
		t.Fatalf("negative CurrentMP = %d, want clamp 0", got)
	}

	character.CurrentHP = vitalTestInt64(0)
	if Alive(character) {
		t.Fatal("explicit zero currentHp must be dead")
	}
	if Alive(nil) || CurrentHP(nil) != 0 || CurrentMP(nil) != 0 {
		t.Fatal("nil character must have zero semantic vitals and be not alive")
	}
}
