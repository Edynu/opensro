package enterworld

import (
	"strings"
	"testing"
)

func TestDepsPointerObservesLateInstalledDoor(t *testing.T) {
	deps := &Deps{}
	captured := deps

	calls := 0
	deps.MutateCharacter = func(_ *Character, label string, fn func()) {
		calls++
		if label != "late-door" {
			t.Fatalf("label = %q", label)
		}
		fn()
	}

	applied := false
	captured.Mutate(&Character{Name: "pointer-owned"}, "late-door", func() {
		applied = true
	})
	if calls != 1 || !applied {
		t.Fatalf("late door calls/applied = %d/%v, want 1/true", calls, applied)
	}
}

func TestDepsValidateRequiresTrainingCampDoor(t *testing.T) {
	err := (&Deps{}).Validate()
	if err == nil || !strings.Contains(err.Error(), "TrainingCamps") {
		t.Fatalf("Validate error = %v, want missing TrainingCamps", err)
	}
}
