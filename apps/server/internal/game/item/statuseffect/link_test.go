package statuseffect

import "testing"

func testLink() Link {
	return Link{DivisionID: "g", SourceName: "warrior", TargetName: "friend", SourceGID: 1, TargetGID: 2,
		SourceToken: 10, TargetToken: 11, SkillID: 7246, SkillGroup: 418, Group: 3, MaxDistance: 1500, MaxOutgoing: 2,
		ThreatPercent: 36, ExpiresAtMs: 10000, ClientCancelable: true}
}

func TestLinkedAdmissionIsAtomicAndBounded(t *testing.T) {
	r := NewRegistry()
	l := testLink()
	if code := r.ApplyLink(l); code != 0 {
		t.Fatal(code)
	}
	l.SourceToken, l.TargetToken = 12, 13
	if code := r.ApplyLink(l); code != 0x300c {
		t.Fatalf("duplicate: %x", code)
	}
	if len(r.Snapshot("g", "warrior")) != 1 || len(r.Snapshot("g", "friend")) != 1 {
		t.Fatal("partial duplicate")
	}
	l.TargetName, l.TargetGID = "second", 3
	if code := r.ApplyLink(l); code != 0 {
		t.Fatal(code)
	}
	l.SourceToken, l.TargetToken, l.TargetName, l.TargetGID = 14, 15, "third", 4
	if code := r.ApplyLink(l); code != 0x3029 {
		t.Fatalf("limit: %x", code)
	}
	if len(r.Snapshot("g", "third")) != 0 {
		t.Fatal("orphan target")
	}
	l.SkillID++
	if code := r.ApplyLink(l); code != 0x300c {
		t.Fatalf("mixed level: %x", code)
	}
	if r.Apply(Effect{DivisionID: "g", CharacterName: "friend", SkillID: 1, SkillGroup: 418, InstanceToken: 11}) {
		t.Fatal("replaced half")
	}
}

func TestLinkedRetirementPropagatesExactlyOnce(t *testing.T) {
	for _, cause := range []string{"source-cancel", "target-cancel", "expiry", "source-disconnect", "target-death"} {
		t.Run(cause, func(t *testing.T) {
			r := NewRegistry()
			l := testLink()
			if r.ApplyLink(l) != 0 {
				t.Fatal("apply")
			}
			switch cause {
			case "source-cancel":
				r.RequestVoluntaryStop("g", "warrior", 7246, 10)
			case "target-cancel":
				r.RequestVoluntaryStop("g", "friend", 7246, 11)
			case "expiry":
				r.Expire(10000)
				if len(r.DrainStopRequested()) != 0 {
					t.Fatal("link retired at equality")
				}
				if _, ok := r.ThreatLink("g", "friend", 10000); !ok {
					t.Fatal("link consumer disagrees with retirement boundary")
				}
				r.Expire(10001)
			case "source-disconnect":
				r.Forget("g", "warrior")
			case "target-death":
				if len(r.RetireBodyStatusesOnDeath("g", "friend")) != 1 {
					t.Fatal("death")
				}
			}
			if _, ok := r.ThreatLink("g", "friend", 9999); ok != (cause == "source-cancel") {
				t.Fatal("request incorrectly propagated across the link before teardown")
			}
			b := r.DrainStopRequested()
			if cause == "target-cancel" || cause == "target-death" {
				// The source's next update resolves link+10 == 0. A target
				// teardown must not itself clear the source retirement flag.
				source := r.Snapshot("g", "warrior")
				if len(source) != 1 || source[0].StopRequested {
					t.Fatal("recipient prematurely stopped source")
				}
				links := r.Links()
				if len(links) != 1 || links[0].TargetGID != 0 {
					t.Fatal("recipient did not detach")
				}
				r.StopLink("g", l.SourceToken)
				b = append(b, r.DrainStopRequested()...)
			}
			want := 2
			if cause == "source-disconnect" || cause == "target-death" {
				want = 1
			}
			if len(b) != want {
				t.Fatalf("batches %d != %d", len(b), want)
			}
			if len(r.Links()) != 0 || len(r.Snapshot("g", "friend")) != 0 || len(r.Snapshot("g", "warrior")) != 0 || len(r.DrainStopRequested()) != 0 {
				t.Fatal("residual pair")
			}
		})
	}
}

func TestLinkedThreatUsesSingleNativeOwnerWithoutRestoringPrevious(t *testing.T) {
	r := NewRegistry()
	l := testLink()
	r.ApplyLink(l)
	n := l
	n.SourceName, n.SourceGID, n.SourceToken, n.TargetToken = "other", 3, 12, 13
	n.ThreatPercent = 60
	r.ApplyLink(n)
	if got, ok := r.ThreatLink("g", "friend", 9999); !ok || got.SourceGID != 3 {
		t.Fatal("latest pointer not installed")
	}
	r.StopLink("g", 10)
	r.DrainStopRequested()
	if _, ok := r.ThreatLink("g", "friend", 9999); ok {
		t.Fatal("native +210 was not cleared on retirement")
	}
	if len(r.Snapshot("g", "friend")) != 1 {
		t.Fatal("unrelated link erased")
	}
}

// Regression: the first source callback adds a new pending owner while the
// drain is running. Its recipient must not become a stranded stopped row.
func TestSourceTeardownForcesProtectedRecipientAndDrainsAppendedOwner(t *testing.T) {
	r := NewRegistry()
	l := testLink()
	if r.ApplyLink(l) != 0 {
		t.Fatal("apply")
	}
	key := ownerKey("g", "friend")
	r.byOwner[key][0].ClientCancelable = false
	if _, ok := r.RequestVoluntaryStop("g", "warrior", l.SkillID, l.SourceToken); !ok {
		t.Fatal("request")
	}
	if r.Snapshot("g", "friend")[0].StopRequested {
		t.Fatal("request forced recipient early")
	}
	b := r.DrainStopRequested()
	if len(b) != 2 || b[0].CharacterName != "warrior" || b[1].CharacterName != "friend" {
		t.Fatalf("callback order: %+v", b)
	}
	if len(r.Links()) != 0 || len(r.DrainStopRequested()) != 0 {
		t.Fatal("stranded callback")
	}
}
