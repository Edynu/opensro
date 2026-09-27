package statuseffect

import (
	"reflect"
	"testing"
)

func movementFixture(token uint32, kind MovementKind, percent uint32) Effect {
	return Effect{DivisionID: "d", CharacterName: "runner", SkillID: token, SkillGroup: token,
		InstanceToken: token, State: StateActive, Movement: true, MovementKind: kind,
		MovementPercent: percent, ClientCancelable: true}
}

func movementContributions(t *testing.T, r *Registry, want ...uint32) {
	t.Helper()
	var got []uint32
	for _, e := range r.Snapshot("d", "runner") {
		got = append(got, e.MovementPercent)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("installed sources: got %v want %v", got, want)
	}
}

// Expected vectors follow the three install branches and the two slot teardown
// branches, not a strongest-buff policy or a count of visible movement icons.
func TestMovementNativeSlotBranches(t *testing.T) {
	for _, tc := range []struct {
		name      string
		kinds     []MovementKind
		installed []uint32
		retire    uint32
		after     []uint32
	}{
		{"plain conflict retires first", []MovementKind{MovementHaste, MovementHaste}, []uint32{20, 0}, 1, []uint32{0}},
		{"plain conflict retires last", []MovementKind{MovementHaste, MovementHaste}, []uint32{20, 0}, 2, []uint32{20}},
		{"override restores base", []MovementKind{MovementHaste, MovementOverride}, []uint32{0, 40}, 2, []uint32{20}},
		{"base ends during override", []MovementKind{MovementHaste, MovementOverride}, []uint32{0, 40}, 1, []uint32{40}},
		{"plain after override", []MovementKind{MovementOverride, MovementHaste}, []uint32{20, 0}, 1, []uint32{40}},
		{"independent before plain", []MovementKind{MovementIndependent, MovementHaste}, []uint32{20, 40}, 1, []uint32{40}},
		{"independent after plain", []MovementKind{MovementHaste, MovementIndependent}, []uint32{20, 40}, 2, []uint32{20}},
		{"independent sources", []MovementKind{MovementIndependent, MovementIndependent}, []uint32{20, 40}, 1, []uint32{40}},
		{"override after independent", []MovementKind{MovementIndependent, MovementOverride}, []uint32{20, 40}, 2, []uint32{20}},
		{"independent after override", []MovementKind{MovementOverride, MovementIndependent}, []uint32{20, 40}, 1, []uint32{40}},
		{"override without base", []MovementKind{MovementOverride, MovementOverride}, []uint32{0, 40}, 2, []uint32{0}},
		{"override anchor ends first", []MovementKind{MovementOverride, MovementOverride}, []uint32{0, 40}, 1, []uint32{40}},
		{"repeated overrides retain base", []MovementKind{MovementHaste, MovementOverride, MovementOverride}, []uint32{0, 40, 60}, 2, []uint32{20, 60}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := NewRegistry()
			for i, kind := range tc.kinds {
				if !r.Apply(movementFixture(uint32(i+1), kind, uint32(i+1)*20)) {
					t.Fatal("apply")
				}
			}
			movementContributions(t, r, tc.installed...)
			if _, ok := r.RequestVoluntaryStop("d", "runner", tc.retire, tc.retire); !ok {
				t.Fatal("stop")
			}
			movementContributions(t, r, tc.installed...) // stop is not teardown
			r.DrainStopRequested()
			movementContributions(t, r, tc.after...)
		})
	}
}

func TestMovementReplacementHandoffAndIdentity(t *testing.T) {
	for _, kind := range []MovementKind{MovementHaste, MovementOverride, MovementIndependent} {
		t.Run(string(rune('0'+kind)), func(t *testing.T) {
			r := NewRegistry()
			old := movementFixture(1, kind, 20)
			if !r.Apply(old) {
				t.Fatal("apply")
			}
			if _, ok := r.RequestVoluntaryStop("d", "runner", 1, 1); !ok {
				t.Fatal("stop")
			}
			next := movementFixture(2, kind, 40)
			next.SkillGroup = old.SkillGroup
			// Failed admission must not consume the pending source or slot.
			invalid := next
			invalid.SkillID = 0
			if r.Apply(invalid) {
				t.Fatal("invalid admitted")
			}
			movementContributions(t, r, 20)
			if !r.Apply(next) {
				t.Fatal("successor")
			}
			movementContributions(t, r, 0, 40)
			r.DrainStopRequested()
			movementContributions(t, r, 40)
			next.MovementPercent = 60
			if !r.Apply(next) {
				t.Fatal("exact identity update")
			}
			movementContributions(t, r, 60)
			r.Forget("d", "runner")
			if !r.Apply(old) {
				t.Fatal("reconnect")
			}
			movementContributions(t, r, 20)
		})
	}
	// A shared skill ID is not permission to install a second live plain source.
	r := NewRegistry()
	a := movementFixture(1, MovementHaste, 20)
	b := a
	b.InstanceToken = 2
	r.Apply(a)
	r.Apply(b)
	movementContributions(t, r, 20, 0)
}

func TestMovementRetirementRestoresProtectedBase(t *testing.T) {
	for _, mode := range []string{"death", "expiry"} {
		t.Run(mode, func(t *testing.T) {
			r := NewRegistry()
			base := movementFixture(1, MovementHaste, 20)
			base.DeathProtected = true
			override := movementFixture(2, MovementOverride, 40)
			override.ExpiresAtMs = 100
			r.Apply(base)
			r.Apply(override)
			if mode == "death" {
				r.RetireBodyStatusesOnDeath("d", "runner")
			} else {
				r.Expire(101)
				r.DrainStopRequested()
			}
			movementContributions(t, r, 20)
		})
	}
}

func TestMovementOldDrainCannotClearSuccessorSlot(t *testing.T) {
	r := NewRegistry()
	old := movementFixture(1, MovementHaste, 20)
	next := movementFixture(2, MovementHaste, 30)
	r.Apply(old)
	r.RequestVoluntaryStop("d", "runner", 1, 1)
	r.Apply(next)
	r.DrainStopRequested()
	r.Apply(movementFixture(3, MovementOverride, 50))
	movementContributions(t, r, 0, 50)
	r.RequestVoluntaryStop("d", "runner", 3, 3)
	r.DrainStopRequested()
	movementContributions(t, r, 30)
}

func TestMovementReplacementTransactionAndIsolation(t *testing.T) {
	r := NewRegistry()
	a := movementFixture(1, MovementHaste, 20)
	b := movementFixture(2, MovementHaste, 40)
	b.SkillGroup = 1
	r.Apply(a)
	other := a
	other.CharacterName = "other"
	other.InstanceToken = 3
	r.Apply(other)
	app := ReplacementApplication{Effect: b, Descriptors: map[uint32]ReplacementDescriptor{
		1: {Category: 3, Group: 1, Rank: 2}, 2: {Category: 3, Group: 1, Rank: 3},
	}}
	if !r.ApplyReplacement(app) {
		t.Fatal("replacement")
	}
	movementContributions(t, r, 0, 40)
	r.DrainStopRequested()
	movementContributions(t, r, 40)
	if got := r.Snapshot("d", "other"); len(got) != 1 || got[0].MovementPercent != 20 {
		t.Fatal("cross-owner mutation", got)
	}
}
