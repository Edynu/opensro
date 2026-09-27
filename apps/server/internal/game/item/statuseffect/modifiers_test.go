package statuseffect

import (
	"math"
	"reflect"
	"testing"

	"opensro.online/server/internal/game/paramkeeper"
)

func TestModifierOwnershipThroughRetirement(t *testing.T) {
	r := NewRegistry()
	writes := []paramkeeper.Write{{Parameter: 5, Value: 20}, {Parameter: 6, Value: 30}}
	m, err := NewModifiers(writes)
	if err != nil {
		t.Fatal(err)
	}
	writes[0].Value = 999
	e := Effect{DivisionID: "d", CharacterName: "c", SkillID: 1, SkillGroup: 1, InstanceToken: 7, ClientCancelable: true, Modifiers: m}
	if !r.Apply(e) {
		t.Fatal("install")
	}
	first := r.ModifierWrites("D", "C")
	if len(first) != 2 || first[0].Value != 20 || first[0].Source == 0 || first[0].Source != first[1].Source {
		t.Fatal(first)
	}
	copy := r.ModifierWrites("d", "c")
	copy[0].Value = 888
	if !reflect.DeepEqual(first, r.ModifierWrites("d", "c")) {
		t.Fatal("mutable query escaped")
	}
	if _, ok := r.RequestVoluntaryStop("d", "c", 1, 7); !ok {
		t.Fatal("stop")
	}
	if !reflect.DeepEqual(first, r.ModifierWrites("d", "c")) {
		t.Fatal("stop erased before retirement")
	}
	e.InstanceToken = 8
	if !r.Apply(e) {
		t.Fatal("replacement install")
	}
	both := r.ModifierWrites("d", "c")
	if len(both) != 4 || both[0].Source == both[2].Source {
		t.Fatal("replacement aliases old owner", both)
	}
	r.DrainStopRequested()
	if got := r.ModifierWrites("d", "c"); !reflect.DeepEqual(got, both[2:]) {
		t.Fatal("old retirement erased replacement", got)
	}
	r.Forget("d", "c")
	if len(r.ModifierWrites("d", "c")) != 0 {
		t.Fatal("disconnect leaked contribution")
	}
	if !r.Apply(e) {
		t.Fatal("reinstall")
	}
	if r.ModifierWrites("d", "c")[0].Source == both[2].Source {
		t.Fatal("reused installation identity")
	}
}

func TestModifierExpiryAndExactReplacement(t *testing.T) {
	r := NewRegistry()
	m, _ := NewModifiers([]paramkeeper.Write{{Parameter: 5, Value: 20}})
	e := Effect{DivisionID: "d", CharacterName: "c", SkillID: 1, SkillGroup: 1, InstanceToken: 7, Modifiers: m, DurationPresent: true, StartedAtMs: 10, ExpiresAtMs: 20}
	if !r.Apply(e) {
		t.Fatal("install")
	}
	first := r.ModifierWrites("d", "c")[0].Source
	if !r.Apply(e) {
		t.Fatal("exact replacement")
	}
	next := r.ModifierWrites("d", "c")
	if len(next) != 1 || next[0].Source == first {
		t.Fatal("exact replacement reused ownership", next)
	}
	r.Expire(20)
	if len(r.DrainStopRequested()) != 0 {
		t.Fatal("strict boundary retired early")
	}
	r.Expire(21)
	if len(r.ModifierWrites("d", "c")) != 1 {
		t.Fatal("expiry request erased before cleanup")
	}
	r.DrainStopRequested()
	if len(r.ModifierWrites("d", "c")) != 0 {
		t.Fatal("expiry leaked")
	}
}

func TestModifierInvalidAndExhaustedInstallIsAtomic(t *testing.T) {
	for _, w := range []paramkeeper.Write{
		{Parameter: 512}, {Parameter: 5, Source: 7}, {Parameter: 5, Channel: 4},
		{Parameter: 5, Value: float32(math.NaN())}, {Parameter: 5, Value: float32(math.Inf(1))},
	} {
		if _, err := NewModifiers([]paramkeeper.Write{w}); err == nil {
			t.Fatal("invalid program", w)
		}
	}
	r := NewRegistry()
	m, _ := NewModifiers([]paramkeeper.Write{{Parameter: 5, Value: 20}})
	e := Effect{DivisionID: "d", CharacterName: "c", SkillID: 1, SkillGroup: 1, InstanceToken: 7, Modifiers: m}
	if !r.Apply(e) {
		t.Fatal("install")
	}
	before := r.Snapshot("d", "c")
	r.nextModifierSource = uint64(math.MaxUint32) + 1
	if r.Apply(e) || !reflect.DeepEqual(before, r.Snapshot("d", "c")) {
		t.Fatal("exhaustion mutated old effect")
	}
}
