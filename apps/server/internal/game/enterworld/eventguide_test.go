package enterworld

import (
	"encoding/json"
	"testing"
	"time"
)

type guideCampFixture struct {
	TrainingCampStore
	member bool
}

func (f guideCampFixture) CampOfCharacter(string, int64) (int64, bool) { return 7, f.member }

func TestAcademyPromptUsesPersistedMembershipIndependentlyOfSeenGuide(t *testing.T) {
	for _, member := range []bool{false, true} {
		character := chinaSpearman()
		deps := testDeps(character)
		deps.TrainingCamps = guideCampFixture{member: member}
		if _, err := HandleEventGuideAck(deps, character, []byte{255, 255, 255, 255}, eventGuideTestClock); err != nil {
			t.Fatal(err)
		}
		result := Build(deps, BootstrapRequest{CharacterName: character.Name})
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		var view struct {
			Member *bool `json:"academyMember"`
		}
		if err := json.Unmarshal(encoded, &view); err != nil {
			t.Fatal(err)
		}
		if view.Member == nil || *view.Member != member {
			t.Fatalf("membership %v lost in bootstrap", member)
		}
	}
}

func TestGuideFirstEntryAckAndVisualFlagsSurviveBootstrap(t *testing.T) {
	character := chinaSpearman()
	character.Mission = nil
	flags := int64(2) // Beginner mark explicitly disabled; effect bit remains set.
	character.VisualFlags = &flags
	deps := testDeps(character)
	first := Build(deps, BootstrapRequest{CharacterName: character.Name})
	if first.EventGuideStateMask != 0 || first.LocalPlayerEntry == nil || first.LocalPlayerEntry.VisualFlags != 2 {
		t.Fatalf("first entry lost authoritative guide/visual state: %+v", first)
	}
	if _, err := HandleEventGuideAck(deps, character, []byte{1, 0, 0, 0}, eventGuideTestClock); err != nil {
		t.Fatal(err)
	}
	next := Build(deps, BootstrapRequest{CharacterName: character.Name})
	if next.EventGuideStateMask != 1 || next.LocalPlayerEntry.VisualFlags != 2 {
		t.Fatal("repeat entry replayed welcome or reset the beginner preference")
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		EventGuideStateMask uint32 `json:"eventGuideStateMask"`
		LocalPlayerEntry    struct {
			VisualFlags *uint8 `json:"visualFlags"`
		} `json:"localPlayerEntry"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	if wire.EventGuideStateMask != 1 || wire.LocalPlayerEntry.VisualFlags == nil || *wire.LocalPlayerEntry.VisualFlags != 2 {
		t.Fatal("bootstrap JSON omitted persisted guide/visual state")
	}
}

// eventGuideTestClock is a fixed instant so the persisted timestamp is an
// exact golden (Node Date.toISOString shape).
var eventGuideTestClock = time.Date(2026, 7, 26, 4, 5, 6, 789_000_000, time.UTC)

func eventGuideTestCharacter() *Character {
	mask := int64(1)
	return &Character{
		ID:            3,
		Name:          "asd2",
		ModelCodename: "CHAR_CH_MAN_ADVENTURER",
		Mission: &MissionRuntime{
			EventGuideStateMask:          &mask,
			EventGuideStateMaskUpdatedAt: "2026-06-30T10:19:26.389Z",
		},
	}
}

// TestEventGuideAckGolden pins SCOUT-B PIN 673: the golden payload
// 78 56 34 12 is the u32le mask 0x12345678; the mission runtime record
// takes the mask + a fresh timestamp, the resolver reads the new mask back,
// and the persist hook runs once.
func TestEventGuideAckGolden(t *testing.T) {
	character := eventGuideTestCharacter()
	persisted := 0
	deps := &Deps{MutateCharacter: func(c *Character, label string, fn func()) {
		if c != character {
			t.Error("commit door got a different character record")
		}
		if label != "eventguide-mask" {
			t.Errorf("commit label = %q, want eventguide-mask", label)
		}
		fn()
		persisted++
	}}

	mask, err := HandleEventGuideAck(deps, character, []byte{0x78, 0x56, 0x34, 0x12}, eventGuideTestClock)
	if err != nil {
		t.Fatalf("golden payload refused: %v", err)
	}
	if mask != 0x12345678 {
		t.Fatalf("mask = 0x%08X, want 0x12345678", mask)
	}
	if character.Mission == nil || character.Mission.EventGuideStateMask == nil {
		t.Fatal("mission runtime mask not written")
	}
	if got := *character.Mission.EventGuideStateMask; got != 0x12345678 {
		t.Fatalf("mission mask = 0x%08X, want 0x12345678", got)
	}
	if got, want := character.Mission.EventGuideStateMaskUpdatedAt, "2026-07-26T04:05:06.789Z"; got != want {
		t.Errorf("updatedAt = %q, want %q", got, want)
	}
	if got := ResolveEventGuideStateMask(character); got != 0x12345678 {
		t.Errorf("ResolveEventGuideStateMask = 0x%08X, want 0x12345678 (mission wins)", got)
	}
	if persisted != 1 {
		t.Errorf("persist hook ran %d times, want 1", persisted)
	}

	// A second ack overwrites (Node semantics: last write wins).
	if _, err := HandleEventGuideAck(deps, character, []byte{0x01, 0x00, 0x00, 0x00}, eventGuideTestClock.Add(time.Second)); err != nil {
		t.Fatalf("second ack refused: %v", err)
	}
	if got := ResolveEventGuideStateMask(character); got != 1 {
		t.Errorf("mask after second ack = 0x%08X, want 0x1", got)
	}
	if persisted != 2 {
		t.Errorf("persist hook ran %d times after second ack, want 2", persisted)
	}
}

// TestEventGuideAckPreservesMissionExtras pins the {...mission} spread: an
// existing mission record's other fields ride through the mask write.
func TestEventGuideAckPreservesMissionExtras(t *testing.T) {
	character := eventGuideTestCharacter()
	before := character.Mission
	oldMask := int64(7)
	before.EventGuideStateMask = &oldMask

	if _, err := HandleEventGuideAck(&Deps{}, character, []byte{0xFF, 0x00, 0x00, 0x00}, eventGuideTestClock); err != nil {
		t.Fatalf("ack refused: %v", err)
	}
	// Copy-then-swap: the OLD record object is untouched (snapshot aliases
	// keep their view), the new one carries the new mask + stamp.
	if *before.EventGuideStateMask != 7 || before.EventGuideStateMaskUpdatedAt != "2026-06-30T10:19:26.389Z" {
		t.Error("old mission record mutated in place; want copy-then-swap")
	}
	if got := *character.Mission.EventGuideStateMask; got != 0xFF {
		t.Errorf("new mask = 0x%X, want 0xFF", got)
	}
}

// TestEventGuideAckMalformed pins the refusal arm: anything that is not
// exactly 4 bytes refuses without touching state or persisting; a nil
// character refuses too.
func TestEventGuideAckMalformed(t *testing.T) {
	for _, payload := range [][]byte{nil, {}, {0x78}, {0x78, 0x56}, {0x78, 0x56, 0x34}, {0x78, 0x56, 0x34, 0x12, 0x00}, make([]byte, 8)} {
		character := eventGuideTestCharacter()
		persisted := 0
		deps := &Deps{MutateCharacter: func(_ *Character, _ string, fn func()) { fn(); persisted++ }}

		if _, err := HandleEventGuideAck(deps, character, payload, eventGuideTestClock); err == nil {
			t.Fatalf("payload of %d bytes must refuse", len(payload))
		}
		if character.Mission.EventGuideStateMask == nil || *character.Mission.EventGuideStateMask != 1 {
			t.Errorf("payload of %d bytes changed the mask", len(payload))
		}
		if character.Mission.EventGuideStateMaskUpdatedAt != "2026-06-30T10:19:26.389Z" {
			t.Errorf("payload of %d bytes touched the timestamp", len(payload))
		}
		if got := ResolveEventGuideStateMask(character); got != 1 {
			t.Errorf("payload of %d bytes changed the resolved mask to 0x%X", len(payload), got)
		}
		if persisted != 0 {
			t.Errorf("payload of %d bytes persisted", len(payload))
		}
	}

	if _, err := HandleEventGuideAck(&Deps{}, nil, []byte{1, 0, 0, 0}, eventGuideTestClock); err == nil {
		t.Fatal("nil character must refuse")
	}
}
