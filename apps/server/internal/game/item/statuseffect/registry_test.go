package statuseffect

import "testing"

func TestRequestVoluntaryStopUsesOwnerSkillAndOptionalInstance(t *testing.T) {
	r := NewRegistry()
	base := Effect{
		DivisionID: "Global", CharacterName: "Alice", SkillID: 100,
		SkillGroup: 7, State: StateActive, ClientCancelable: true,
	}
	r.Apply(base)
	r.Apply(Effect{
		DivisionID: "Global", CharacterName: "Alice", SkillID: 101,
		SkillGroup: 7, InstanceToken: 22, State: StatePending, ClientCancelable: true,
	})
	r.Apply(Effect{
		DivisionID: "Global", CharacterName: "Bob", SkillID: 102,
		SkillGroup: 7, InstanceToken: 33, State: StateActive, ClientCancelable: true,
	})

	for _, request := range [][2]uint32{{7, 0}, {100, 22}, {102, 0}} {
		if _, ok := r.RequestVoluntaryStop("GLOBAL", "ALICE", request[0], request[1]); ok {
			t.Fatalf("group alias, wrong instance or foreign owner matched: %v", request)
		}
	}
	requested, ok := r.RequestVoluntaryStop("GLOBAL", "ALICE", 101, 22)
	if !ok || requested.SkillID != 101 || !requested.StopRequested {
		t.Fatalf("instance stop request = %+v, %v; want stopped skill 101", requested, ok)
	}
	if rows := r.Snapshot("global", "alice"); len(rows) != 2 || !rows[1].StopRequested {
		t.Fatalf("request phase erased or failed to mark Alice's effect: %+v", rows)
	}
	batches := r.DrainStopRequested()
	if len(batches) != 1 || len(batches[0].Effects) != 1 || batches[0].Effects[0].SkillID != 101 {
		t.Fatalf("retirement batches = %+v, want Alice skill 101", batches)
	}
	if rows := r.Snapshot("global", "alice"); len(rows) != 1 || rows[0].SkillID != 100 {
		t.Fatalf("Alice rows after retirement = %+v, want only the untokened effect", rows)
	}
	if rows := r.Snapshot("global", "bob"); len(rows) != 1 {
		t.Fatalf("cross-owner cancellation removed Bob's effect: %+v", rows)
	}
}

func TestRequestVoluntaryStopHonorsDescriptorAndLiveState(t *testing.T) {
	r := NewRegistry()
	r.Apply(Effect{
		DivisionID: "g", CharacterName: "a", SkillID: 1, SkillGroup: 9,
		State: StateActive, ClientCancelable: false,
	})
	if _, ok := r.RequestVoluntaryStop("g", "a", 1, 0); ok {
		t.Fatal("a server-protected effect was voluntarily cancelled")
	}
	if len(r.Snapshot("g", "a")) != 1 {
		t.Fatal("the protected row was mutated")
	}
}

func TestRequestVoluntaryStopDoesNotScanPastProtectedFirstMatch(t *testing.T) {
	r := NewRegistry()
	r.Apply(Effect{
		DivisionID: "g", CharacterName: "a", SkillID: 1, SkillGroup: 9,
		InstanceToken: 11, State: StateActive, ClientCancelable: false,
	})
	r.Apply(Effect{
		DivisionID: "g", CharacterName: "a", SkillID: 1, SkillGroup: 9,
		InstanceToken: 22, State: StateActive, ClientCancelable: true,
	})
	if matched, stopped := r.RequestVoluntaryStop("g", "a", 1, 0); stopped || matched.SkillID != 1 {
		t.Fatalf("wildcard lookup = %+v/%v, want protected first row and no stop", matched, stopped)
	}
	rows := r.Snapshot("g", "a")
	if rows[0].StopRequested || rows[1].StopRequested {
		t.Fatalf("permission gate scanned past the first native list match: %+v", rows)
	}
}

func TestRequestVoluntaryStopIsIdempotentUntilRetirement(t *testing.T) {
	r := NewRegistry()
	r.Apply(Effect{
		DivisionID: "g", CharacterName: "a", SkillID: 1, SkillGroup: 9,
		InstanceToken: 44, State: StateActive, ClientCancelable: true,
	})
	if _, ok := r.RequestVoluntaryStop("g", "a", 1, 0); !ok {
		t.Fatal("first stop request missed")
	}
	if _, ok := r.RequestVoluntaryStop("g", "a", 1, 0); ok {
		t.Fatal("a second request re-owned an already stopped effect")
	}
	if batches := r.DrainStopRequested(); len(batches) != 1 {
		t.Fatalf("drained %d batch(es), want one", len(batches))
	}
	if batches := r.DrainStopRequested(); len(batches) != 0 {
		t.Fatalf("ended effect was broadcast twice: %+v", batches)
	}
}

func TestApplyReplacesExactGroupInstanceAndForgetIsIdempotent(t *testing.T) {
	r := NewRegistry()
	r.Apply(Effect{DivisionID: "g", CharacterName: "a", SkillID: 1, SkillGroup: 4, InstanceToken: 8})
	r.Apply(Effect{DivisionID: "g", CharacterName: "a", SkillID: 2, SkillGroup: 4, InstanceToken: 8})
	rows := r.Snapshot("g", "a")
	if len(rows) != 1 || rows[0].SkillID != 2 || rows[0].State != StateActive {
		t.Fatalf("replacement = %+v", rows)
	}
	r.Forget("G", "A")
	r.Forget("g", "a")
	if len(r.Snapshot("g", "a")) != 0 {
		t.Fatal("forgotten rows survived")
	}
}

func TestApplyEnforcesCountedTeardownOwnershipLimit(t *testing.T) {
	r := NewRegistry()
	for token := 1; token <= MaxAttachedEffectsPerCharacter; token++ {
		if !r.Apply(Effect{
			DivisionID: "g", CharacterName: "a", SkillID: uint32(token),
			SkillGroup: uint32(token), InstanceToken: uint32(token),
		}) {
			t.Fatalf("effect %d was refused before the u8 wire limit", token)
		}
	}
	if r.Apply(Effect{
		DivisionID: "g", CharacterName: "a", SkillID: 999,
		SkillGroup: 999, InstanceToken: 999,
	}) {
		t.Fatal("registry admitted a 256th effect that cannot be represented by the teardown count")
	}
	if !r.Apply(Effect{
		DivisionID: "g", CharacterName: "a", SkillID: 1000,
		SkillGroup: 1, InstanceToken: 1,
	}) {
		t.Fatal("exact replacement was blocked at capacity")
	}
	if rows := r.Snapshot("g", "a"); len(rows) != MaxAttachedEffectsPerCharacter || rows[0].SkillID != 1000 {
		t.Fatalf("capacity/replacement rows = %d/%+v", len(rows), rows[0])
	}
}

func TestPublishedTokensHaveOneOwnerPerDivision(t *testing.T) {
	r := NewRegistry()
	row := Effect{DivisionID: "Global", CharacterName: "Alice", SkillID: 7, SkillGroup: 1, InstanceToken: 22, State: StateActive}
	if !r.Apply(row) {
		t.Fatal("initial apply")
	}
	row.CharacterName = "Bob"
	if r.Apply(row) {
		t.Fatal("cross-owner token alias admitted")
	}
	row.DivisionID = "Test"
	if !r.Apply(row) {
		t.Fatal("independent division token refused")
	}
}
