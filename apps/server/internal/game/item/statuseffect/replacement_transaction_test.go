package statuseffect

import (
	"reflect"
	"sync"
	"testing"
)

func TestReplacementTransactionConcurrentTokenAdmission(t *testing.T) {
	r, a := replacementFixture(t)
	var wg sync.WaitGroup
	results := make(chan bool, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- r.ApplyReplacement(a) }()
	}
	wg.Wait()
	close(results)
	accepted := 0
	for ok := range results {
		if ok {
			accepted++
		}
	}
	if accepted != 1 || len(r.Snapshot("d", "target")) != 2 {
		t.Fatal("non-atomic token admission", accepted)
	}
	if ended := r.DrainStopRequested(); len(ended) != 1 || len(ended[0].Effects) != 1 {
		t.Fatal("duplicate retirement", ended)
	}
}

func TestReplacementValidationRetiresWithoutInstalling(t *testing.T) {
	r, a := replacementFixture(t)
	a.Effect.InstanceToken = 0 // validation precedes new-instance allocation
	if !r.RequestReplacement(a) {
		t.Fatal("validation refused")
	}
	rows := r.Snapshot("d", "target")
	if len(rows) != 1 || !rows[0].StopRequested || rows[0].InstanceToken != 1 {
		t.Fatal("validation installed or erased an effect", rows)
	}
	if !r.CastingStates("d", "target").Conflicts(5) {
		t.Fatal("validation prematurely removed modifiers")
	}
	// No subsequent installation is necessary for the old retirement to occur.
	ended := r.DrainStopRequested()
	if len(ended) != 1 || len(ended[0].Effects) != 1 || len(r.Snapshot("d", "target")) != 0 {
		t.Fatal("failed later installation would roll back native retirement", ended)
	}
}

func TestReplacementValidationRejectsWithoutRetiring(t *testing.T) {
	r, a := replacementFixture(t)
	d := a.Descriptors[2]
	d.Rank = 1
	a.Descriptors[2] = d
	if r.RequestReplacement(a) || r.Snapshot("d", "target")[0].StopRequested || len(r.DrainStopRequested()) != 0 {
		t.Fatal("weaker replacement changed the old effect")
	}
}

func replacementFixture(t *testing.T) (*Registry, ReplacementApplication) {
	t.Helper()
	r := NewRegistry()
	e := Effect{DivisionID: "d", CharacterName: "target", OwnerGID: 10, SkillID: 1, SkillGroup: 7, InstanceToken: 1, State: StateActive, Phase: 2, InstalledStates: [2]uint32{5}, RetirementStates: [2]uint32{5}}
	if !r.Apply(e) {
		t.Fatal("seed")
	}
	e.SkillID, e.InstanceToken = 2, 2
	return r, ReplacementApplication{Effect: e, Descriptors: map[uint32]ReplacementDescriptor{
		1: {Category: 3, Group: 7, Rank: 2}, 2: {Category: 3, Group: 7, Rank: 2, PackedStates: 5},
	}}
}

func TestReplacementTransactionDeferredRetirement(t *testing.T) {
	r, a := replacementFixture(t)
	a.CurrentPacked = 5 // replacement bypasses active and current conflicts
	if !r.ApplyReplacement(a) {
		t.Fatal("equal-rank replacement refused")
	}
	rows := r.Snapshot("d", "target")
	if len(rows) != 2 || !rows[0].StopRequested || rows[1].StopRequested || rows[0].ClientCancelable {
		t.Fatal("replacement must stop protected row without erasing it", rows)
	}
	if !r.CastingStates("d", "target").Conflicts(5) {
		t.Fatal("stop cleared too early")
	}
	ended := r.DrainStopRequested()
	if len(ended) != 1 || len(ended[0].Effects) != 1 || ended[0].Effects[0].InstanceToken != 1 {
		t.Fatal("retirement identity", ended)
	}
	if rows = r.Snapshot("d", "target"); len(rows) != 1 || rows[0].InstanceToken != 2 {
		t.Fatal("new effect lost")
	}
	// Native direct bit clearing does not count the new row as a second owner.
	if r.CastingStates("d", "target").Conflicts(5) {
		t.Fatal("cleanup became reference counting")
	}
}

func TestReplacementTransactionRejectionsAreAtomic(t *testing.T) {
	for _, kind := range []string{"lower-rank", "token", "metadata", "current-conflict", "active-conflict", "capacity"} {
		t.Run(kind, func(t *testing.T) {
			r, a := replacementFixture(t)
			switch kind {
			case "lower-rank":
				d := a.Descriptors[2]
				d.Rank = 1
				a.Descriptors[2] = d
			case "token":
				a.Effect.InstanceToken = 1
			case "metadata":
				delete(a.Descriptors, 1)
			case "current-conflict", "active-conflict":
				d := a.Descriptors[2]
				d.Group = 8
				d.PackedStates = 6
				a.Descriptors[2] = d
				a.Effect.SkillGroup = 8
				if kind == "current-conflict" {
					a.CurrentPacked = 6
				} else {
					d.PackedStates = 5
					a.Descriptors[2] = d
				}
			case "capacity":
				for i := uint32(3); i <= 256; i++ {
					e := a.Effect
					e.SkillID = i
					e.SkillGroup = i
					e.InstanceToken = i
					e.InstalledStates = [2]uint32{}
					if !r.Apply(e) {
						t.Fatal("fill", i)
					}
					a.Descriptors[i] = ReplacementDescriptor{Group: i}
				}
			}
			before := r.Snapshot("d", "target")
			states := r.CastingStates("d", "target")
			if r.ApplyReplacement(a) {
				t.Fatal("accepted", kind)
			}
			if !reflect.DeepEqual(before, r.Snapshot("d", "target")) || states != r.CastingStates("d", "target") || len(r.DrainStopRequested()) != 0 {
				t.Fatal("rejection mutated live owner")
			}
		})
	}
}

func TestReplacementTransactionAreaPeerUsesExactSkillAndActor(t *testing.T) {
	for _, valid := range []bool{false, true} {
		r, a := replacementFixture(t)
		old := r.Snapshot("d", "target")[0]
		old.AreaSourceName, old.AreaSourceGID = "source", 20
		if !r.Apply(old) {
			t.Fatal("area seed")
		}
		for _, id := range []uint32{3, 1} {
			peer := old
			peer.CharacterName = "source"
			peer.OwnerGID = 20
			peer.SkillID = id
			peer.InstanceToken = id + 10
			peer.AreaSourceGID = 0
			peer.AreaSourceName = ""
			if !valid {
				peer.OwnerGID = 21
			}
			if !r.Apply(peer) {
				t.Fatal("peer")
			}
		}
		for _, id := range []uint32{1, 2} {
			d := a.Descriptors[id]
			d.Efr2 = true
			d.BasicCode = "area"
			a.Descriptors[id] = d
		}
		// Failed peer resolution skips area replacement; active conflict rejects.
		if got := r.ApplyReplacement(a); got != valid {
			t.Fatal("actor identity", valid, got)
		}
		peers := r.Snapshot("d", "source")
		if peers[0].StopRequested || peers[1].StopRequested != valid {
			t.Fatal("group alias or wrong actor retired", peers)
		}
		if valid && len(r.DrainStopRequested()) != 2 {
			t.Fatal("pair not queued atomically")
		}
	}
}
