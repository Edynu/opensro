package store

// Multi-record commit door (MutateCharacters) tests: a mutual pair of
// record mutations commits in ONE transaction (the friend lane's edge
// pair - two sequential MutateCharacter doors would commit twice and a
// process death between them tears the mutual-edge invariant), fn runs
// unconditionally, a failed commit retains EVERY dirty flag so the next
// successful commit heals both records together, and the declaration
// list is nil-safe, duplicate-safe and escalates on foreign records
// exactly like the single-record door.

import (
	"errors"
	"strings"
	"testing"

	"opensro.online/server/internal/game/enterworld"
)

// TestMutateCharactersPairCommitsAtomically: two characters through one
// door, both mutations durable across a reopen, the dirty set cleared by
// the single successful commit, and fn running even for an empty
// declaration list.
func TestMutateCharactersPairCommitsAtomically(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	clock := newTestClock()
	s := openTest(t, dir, clock)

	alice := &enterworld.Character{Name: "edgealice"}
	bob := &enterworld.Character{Name: "edgebob"}
	for _, c := range []*enterworld.Character{alice, bob} {
		if err := s.CreateCharacter(testDivision, "test-account", c); err != nil {
			t.Fatal(err)
		}
	}

	ran := false
	s.MutateCharacters([]*enterworld.Character{alice, bob}, "friend-add edgealice+edgebob", func() {
		alice.Gold = int64Ptr(111)
		bob.Gold = int64Ptr(222)
		ran = true
	})
	if !ran {
		t.Fatal("the door must run fn")
	}
	if len(s.changes.characters) != 0 || s.changes.all {
		t.Fatalf("the single successful commit must clear the dirty set: %d entries, dirtyAll=%v", len(s.changes.characters), s.changes.all)
	}

	// An empty declaration still runs fn and still commits (the door
	// contract: refusal decisions belong BEFORE the door).
	ran = false
	s.MutateCharacters(nil, "friend-noop", func() { ran = true })
	if !ran {
		t.Fatal("the door must run fn even with nothing declared")
	}
	s.Close()

	s2 := openTest(t, dir, clock)
	byName := map[string]*enterworld.Character{}
	for _, c := range s2.Characters().CharactersForDivision(testDivision) {
		byName[c.Name] = c
	}
	if c := byName["edgealice"]; c == nil || c.Gold == nil || *c.Gold != 111 {
		t.Fatalf("alice's half of the pair did not persist: %+v", c)
	}
	if c := byName["edgebob"]; c == nil || c.Gold == nil || *c.Gold != 222 {
		t.Fatalf("bob's half of the pair did not persist: %+v", c)
	}
}

// TestMutateCharactersFailureKeepsBothDirty: ONE commit attempt per door
// call (FailedWrites counts attempts, so the two-door shape this door
// replaces would count 2), fn runs even though the commit is doomed,
// BOTH records stay dirty - neither silently dropped - and the healing
// commit carries both mutations to disk together.
func TestMutateCharactersFailureKeepsBothDirty(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	clock := newTestClock()
	s := openTest(t, dir, clock)

	alice := &enterworld.Character{Name: "faultalice"}
	bob := &enterworld.Character{Name: "faultbob"}
	for _, c := range []*enterworld.Character{alice, bob} {
		if err := s.CreateCharacter(testDivision, "test-account", c); err != nil {
			t.Fatal(err)
		}
	}

	s.commitFail = errors.New("disk on fire")
	ran := false
	s.MutateCharacters([]*enterworld.Character{alice, bob}, "friend-add faultpair", func() {
		alice.Gold = int64Ptr(1000)
		bob.Gold = int64Ptr(2000)
		ran = true
	})
	if !ran {
		t.Fatal("fn must run unconditionally - a refusing door drops the gameplay mutation")
	}
	health := s.Health()
	if health.FailedWrites != 1 {
		t.Fatalf("one door call must be exactly ONE commit attempt, counted %d failure(s)", health.FailedWrites)
	}
	if !strings.Contains(health.LastError, "friend-add faultpair") {
		t.Fatalf("health must carry the op label for attribution: %+v", health)
	}
	if !s.changes.characters[alice] || !s.changes.characters[bob] {
		t.Fatalf("failed commit must retain BOTH dirty flags: alice=%v bob=%v", s.changes.characters[alice], s.changes.characters[bob])
	}
	if *alice.Gold != 1000 || *bob.Gold != 2000 {
		t.Fatal("fail-open: the in-memory mutations must stand")
	}

	s.commitFail = nil
	s.MutateCharacters(nil, "friend-heal", nil)
	if got := s.Health(); got.FailedWrites != 0 {
		t.Fatalf("health must self-heal after the successful commit: %+v", got)
	}
	s.Close()

	s2 := openTest(t, dir, clock)
	byName := map[string]*enterworld.Character{}
	for _, c := range s2.Characters().CharactersForDivision(testDivision) {
		byName[c.Name] = c
	}
	if c := byName["faultalice"]; c == nil || c.Gold == nil || *c.Gold != 1000 {
		t.Fatalf("the healing commit dropped alice's half: %+v", c)
	}
	if c := byName["faultbob"]; c == nil || c.Gold == nil || *c.Gold != 2000 {
		t.Fatalf("the healing commit dropped bob's half: %+v", c)
	}
}

// TestMutateCharactersNilAndDuplicateEntries: nil entries are skipped
// and a repeated pointer marks once - the dirty set stays exactly the
// declared records, with no whole-world escalation.
func TestMutateCharactersNilAndDuplicateEntries(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	clock := newTestClock()
	s := openTest(t, dir, clock)

	solo := &enterworld.Character{Name: "soloedge"}
	if err := s.CreateCharacter(testDivision, "test-account", solo); err != nil {
		t.Fatal(err)
	}

	// The failpoint freezes the dirty set so it can be inspected.
	s.commitFail = errors.New("hold the commit")
	s.MutateCharacters([]*enterworld.Character{nil, solo, solo, nil}, "friend-add soloedge", func() {
		solo.Gold = int64Ptr(7)
	})
	if len(s.changes.characters) != 1 || !s.changes.characters[solo] {
		t.Fatalf("dirty set = %d entries (solo=%v), want exactly the one declared record", len(s.changes.characters), s.changes.characters[solo])
	}
	if s.changes.all {
		t.Fatal("nil entries must not escalate to the whole-world commit")
	}

	s.commitFail = nil
	s.MutateCharacters([]*enterworld.Character{solo}, "friend-heal soloedge", nil)
	s.Close()

	s2 := openTest(t, dir, clock)
	reloaded := s2.Characters().CharactersForDivision(testDivision)[0]
	if reloaded.Gold == nil || *reloaded.Gold != 7 {
		t.Fatalf("persisted gold = %v, want 7", reloaded.Gold)
	}
}

// TestMutateCharactersUnknownRecordEscalates: a record the store does
// not own escalates to the whole-world commit (the MutateCharacter
// posture) without entering the scoped dirty set - a foreign pointer
// there would fail every commit on its missing division binding.
func TestMutateCharactersUnknownRecordEscalates(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	clock := newTestClock()
	s := openTest(t, dir, clock)

	known := &enterworld.Character{Name: "knownedge"}
	if err := s.CreateCharacter(testDivision, "test-account", known); err != nil {
		t.Fatal(err)
	}
	detached := &enterworld.Character{Name: "detachedghost"}

	s.commitFail = errors.New("hold the commit")
	ran := false
	s.MutateCharacters([]*enterworld.Character{known, detached}, "friend-add detachedghost", func() {
		known.Gold = int64Ptr(31)
		ran = true
	})
	if !ran {
		t.Fatal("fn must run unconditionally")
	}
	if !s.changes.all {
		t.Fatal("an unknown record must escalate to the whole-world commit (the MutateCharacter posture)")
	}
	if s.changes.characters[detached] {
		t.Fatal("a foreign record must not enter the scoped dirty set")
	}

	s.commitFail = nil
	s.Mutate("friend-heal detachedghost", nil)
	s.Close()

	s2 := openTest(t, dir, clock)
	live := s2.Characters().CharactersForDivision(testDivision)
	if len(live) != 1 || live[0].Gold == nil || *live[0].Gold != 31 {
		t.Fatalf("the escalated commit must persist the known record's mutation: %+v", live)
	}
}
