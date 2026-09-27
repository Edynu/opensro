/*
===========================================================================

friend_test.go - tests for friend.go

===========================================================================
*/

package community

import (
	"bytes"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
)

func friendAddPayload(name string) []byte {
	writer := wire.NewWriter(2 + len(name))
	writer.U16(uint16(len(name)))
	writer.Bytes([]byte(name))
	return writer.Payload()
}

func friendDeletePayload(jid uint32) []byte {
	writer := wire.NewWriter(4)
	writer.U32(jid)
	return writer.Payload()
}

func TestDecodeFriendAddRequest(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
		want    string
		wantErr bool
	}{
		{"ok", friendAddPayload("Berk"), "Berk", false},
		{"empty name", friendAddPayload(""), "", true},
		{"short header", []byte{0x04}, "", true},
		{"short body", []byte{0x04, 0x00, 'B'}, "", true},
		{"trailing bytes", append(friendAddPayload("Berk"), 0x00), "", true},
	}
	for _, tc := range cases {
		got, err := DecodeFriendAddRequest(tc.payload)
		if tc.wantErr {
			if err == nil {
				t.Errorf("%s: decode = %q, want error", tc.name, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: decode error %v", tc.name, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%s: decode = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestDecodeFriendDeleteRequest(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
		want    uint32
		wantErr bool
	}{
		{"ok", friendDeletePayload(0x01020304), 0x01020304, false},
		{"short", []byte{0x01, 0x02}, 0, true},
		{"trailing bytes", append(friendDeletePayload(7), 0x00), 0, true},
	}
	for _, tc := range cases {
		got, err := DecodeFriendDeleteRequest(tc.payload)
		if tc.wantErr {
			if err == nil {
				t.Errorf("%s: decode = %d, want error", tc.name, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: decode error %v", tc.name, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%s: decode = %d, want %d", tc.name, got, tc.want)
		}
	}
}

/*
==================
TestEncodeFriendEvents3F9A

TestEncodeFriendEvents3F9A pins the three friend event bodies byte for
byte against the client's sub_760fb0 reads: case 2 {u8 2, u32 jid,
u16 len + ANSI name, u32 model}, case 3 {u8 3, u32 jid}, case 4
{u8 4, u32 jid, u8 state}.
==================
*/
func TestEncodeFriendEvents3F9A(t *testing.T) {
	added := EncodeFriendEventAdded3F9A(0x00000002, "Berk", 1907)
	wantAdded := []byte{
		0x02,
		0x02, 0x00, 0x00, 0x00,
		0x04, 0x00, 'B', 'e', 'r', 'k',
		0x73, 0x07, 0x00, 0x00,
	}
	if !bytes.Equal(added, wantAdded) {
		t.Errorf("case 2 = % X, want % X", added, wantAdded)
	}
	deleted := EncodeFriendEventDeleted3F9A(0x0A0B0C0D)
	wantDeleted := []byte{0x03, 0x0D, 0x0C, 0x0B, 0x0A}
	if !bytes.Equal(deleted, wantDeleted) {
		t.Errorf("case 3 = % X, want % X", deleted, wantDeleted)
	}
	state := EncodeFriendEventState3F9A(5, FriendStateOffline)
	wantState := []byte{0x04, 0x05, 0x00, 0x00, 0x00, 0x01}
	if !bytes.Equal(state, wantState) {
		t.Errorf("case 4 = % X, want % X", state, wantState)
	}
}

// TestEncodeFriendRosterFromEdges pins the seeded 0x3769 body over a
// persisted edge list with the nil-presence (all-offline) derivation.
func TestEncodeFriendRosterFromEdges(t *testing.T) {
	character := &enterworld.Character{
		ID:   1,
		Name: "Alfa",
		Friends: []enterworld.FriendRecord{
			{ID: 2, Name: "Berk", ModelRefID: 1907},
		},
	}
	entries := FriendRosterEntries(nil, "global-official", character)
	payload := EncodeFriendRoster3769(entries)
	want := []byte{
		0x01,
		0x02, 0x00, 0x00, 0x00,
		0x04, 0x00, 'B', 'e', 'r', 'k',
		0x73, 0x07, 0x00, 0x00,
		0x01, // offline: nil presence can claim nothing else
	}
	if !bytes.Equal(payload, want) {
		t.Errorf("roster = % X, want % X", payload, want)
	}
	if empty := FriendRosterEntries(nil, "global-official", &enterworld.Character{ID: 3}); empty != nil {
		t.Errorf("entries for an edge-less character = %v, want nil", empty)
	}
}

func friendTestPair() (*enterworld.Deps, *enterworld.Character, *enterworld.Character) {
	race := enterworld.RaceChina
	male := enterworld.GenderMale
	actor := &enterworld.Character{ID: 1, Name: "Alfa", ModelCodename: "CHAR_CH_MAN_ADVENTURER", RaceIndex: &race, Gender: &male}
	target := &enterworld.Character{ID: 2, Name: "Berk", ModelCodename: "CHAR_CH_MAN_ADVENTURER", RaceIndex: &race, Gender: &male}
	deps := &enterworld.Deps{
		Roster: &enterworld.Roster{},
		Characters: enterworld.StaticCharacterSource{
			"global-official": {actor, target},
		},
	}
	return deps, actor, target
}

func alwaysOnline(string) bool { return true }

func TestHandleFriendAddSuccessIsMutual(t *testing.T) {
	deps, actor, target := friendTestPair()
	outcome := HandleFriendAdd(deps, "global-official", actor, friendAddPayload("Berk"), alwaysOnline)
	if outcome.Refusal != "" {
		t.Fatalf("add refused: %s", outcome.Refusal)
	}
	if outcome.TargetName != "Berk" {
		t.Errorf("target name = %q, want Berk", outcome.TargetName)
	}
	wantTargetEdge := enterworld.FriendRecord{ID: 2, Name: "Berk", ModelRefID: 1907}
	wantActorEdge := enterworld.FriendRecord{ID: 1, Name: "Alfa", ModelRefID: 1907}
	if outcome.TargetEntry != wantTargetEdge {
		t.Errorf("target entry = %+v, want %+v", outcome.TargetEntry, wantTargetEdge)
	}
	if outcome.ActorEntry != wantActorEdge {
		t.Errorf("actor entry = %+v, want %+v", outcome.ActorEntry, wantActorEdge)
	}
	if got := enterworld.FriendsView(actor); len(got) != 1 || got[0] != wantTargetEdge {
		t.Errorf("actor edges = %+v, want [%+v]", got, wantTargetEdge)
	}
	if got := enterworld.FriendsView(target); len(got) != 1 || got[0] != wantActorEdge {
		t.Errorf("target edges = %+v, want [%+v]", got, wantActorEdge)
	}
}

func TestHandleFriendAddRefusalArms(t *testing.T) {
	cases := []struct {
		name    string
		prepare func(deps *enterworld.Deps, actor, target *enterworld.Character)
		payload []byte
		online  func(string) bool
	}{
		{"malformed", nil, []byte{0xFF}, alwaysOnline},
		{"empty name", nil, friendAddPayload(""), alwaysOnline},
		{"self add", nil, friendAddPayload("Alfa"), alwaysOnline},
		{"self add case-insensitive", nil, friendAddPayload("ALFA"), alwaysOnline},
		{"unknown target", nil, friendAddPayload("Cale"), alwaysOnline},
		{"target delete-pending", func(_ *enterworld.Deps, _, target *enterworld.Character) {
			target.DeletePending = true
		}, friendAddPayload("Berk"), alwaysOnline},
		{"duplicate", func(_ *enterworld.Deps, actor, target *enterworld.Character) {
			actor.Friends = []enterworld.FriendRecord{{ID: target.ID, Name: target.Name, ModelRefID: 1907}}
		}, friendAddPayload("Berk"), alwaysOnline},
		{"actor list full", func(_ *enterworld.Deps, actor, _ *enterworld.Character) {
			for i := int64(0); i < FriendMaxCount; i++ {
				actor.Friends = append(actor.Friends, enterworld.FriendRecord{ID: 100 + i})
			}
		}, friendAddPayload("Berk"), alwaysOnline},
		{"target list full", func(_ *enterworld.Deps, _, target *enterworld.Character) {
			for i := int64(0); i < FriendMaxCount; i++ {
				target.Friends = append(target.Friends, enterworld.FriendRecord{ID: 100 + i})
			}
		}, friendAddPayload("Berk"), alwaysOnline},
		{"target offline", nil, friendAddPayload("Berk"), func(string) bool { return false }},
		{"nil online predicate", nil, friendAddPayload("Berk"), nil},
	}
	for _, tc := range cases {
		deps, actor, target := friendTestPair()
		if tc.prepare != nil {
			tc.prepare(deps, actor, target)
		}
		before := len(enterworld.FriendsView(actor))
		outcome := HandleFriendAdd(deps, "global-official", actor, tc.payload, tc.online)
		if outcome.Refusal == "" {
			t.Errorf("%s: add accepted, want refusal", tc.name)
			continue
		}
		if got := len(enterworld.FriendsView(actor)); got != before {
			t.Errorf("%s: actor edge count changed %d -> %d on a refusal", tc.name, before, got)
		}
	}
	// The actor delete-pending arm needs its own character shape.
	deps, actor, _ := friendTestPair()
	actor.DeletePending = true
	if outcome := HandleFriendAdd(deps, "global-official", actor, friendAddPayload("Berk"), alwaysOnline); outcome.Refusal == "" {
		t.Errorf("delete-pending actor: add accepted, want refusal")
	}
}

func TestHandleFriendDelete(t *testing.T) {
	deps, actor, target := friendTestPair()
	if outcome := HandleFriendAdd(deps, "global-official", actor, friendAddPayload("Berk"), alwaysOnline); outcome.Refusal != "" {
		t.Fatalf("seed add refused: %s", outcome.Refusal)
	}

	// A jid the actor does not list refuses and mutates nothing.
	if outcome := HandleFriendDelete(deps, "global-official", actor, friendDeletePayload(99)); outcome.Refusal == "" {
		t.Fatalf("unknown jid accepted, want refusal")
	}
	if got := len(enterworld.FriendsView(actor)); got != 1 {
		t.Fatalf("actor edges after refused delete = %d, want 1", got)
	}

	// Malformed body refuses.
	if outcome := HandleFriendDelete(deps, "global-official", actor, []byte{0x01}); outcome.Refusal == "" {
		t.Fatalf("malformed delete accepted, want refusal")
	}

	// The real delete removes BOTH sides and reports the mutual removal.
	outcome := HandleFriendDelete(deps, "global-official", actor, friendDeletePayload(2))
	if outcome.Refusal != "" {
		t.Fatalf("delete refused: %s", outcome.Refusal)
	}
	if outcome.FriendJID != 2 || outcome.ActorJID != 1 {
		t.Errorf("outcome jids = %d/%d, want 2/1", outcome.FriendJID, outcome.ActorJID)
	}
	if !outcome.TargetRemoved || outcome.TargetName != "Berk" {
		t.Errorf("mutual removal = %v (%q), want true (Berk)", outcome.TargetRemoved, outcome.TargetName)
	}
	if got := len(enterworld.FriendsView(actor)); got != 0 {
		t.Errorf("actor edges after delete = %d, want 0", got)
	}
	if got := len(enterworld.FriendsView(target)); got != 0 {
		t.Errorf("target edges after delete = %d, want 0", got)
	}
}

/*
==================
TestHandleFriendDeleteRefusesMissingTarget

TestHandleFriendDeleteRefusesMissingTarget pins the fail-closed graph
boundary: final deletion removes inbound edges in the store transaction,
so a listed-but-missing target is drift, never a one-sided cleanup path.
==================
*/
func TestHandleFriendDeleteRefusesMissingTarget(t *testing.T) {
	race := enterworld.RaceChina
	male := enterworld.GenderMale
	actor := &enterworld.Character{
		ID: 1, Name: "Alfa", ModelCodename: "CHAR_CH_MAN_ADVENTURER",
		RaceIndex: &race, Gender: &male,
		Friends: []enterworld.FriendRecord{{ID: 2, Name: "Berk", ModelRefID: 1907}},
	}
	deps := &enterworld.Deps{
		Roster:     &enterworld.Roster{},
		Characters: enterworld.StaticCharacterSource{"global-official": {actor}},
	}
	outcome := HandleFriendDelete(deps, "global-official", actor, friendDeletePayload(2))
	if outcome.Refusal == "" {
		t.Fatal("delete with a missing target accepted")
	}
	if outcome.TargetRemoved {
		t.Errorf("TargetRemoved = true on refusal")
	}
	if got := len(enterworld.FriendsView(actor)); got != 1 {
		t.Errorf("actor edges = %d, want the untouched edge", got)
	}
}

/*
==================
TestFriendModelRef

TestFriendModelRef pins the resolution chain: an explicit ModelRef the
roster knows first, then the race/gender start-profile fallback. An
explicit ref with no roster row never reaches the wire unvalidated.
==================
*/
func TestFriendModelRef(t *testing.T) {
	race := enterworld.RaceChina
	female := enterworld.GenderFemale
	explicit := int64(4321)
	withRef := &enterworld.Character{ModelRef: &explicit, RaceIndex: &race, Gender: &female}
	roster := &enterworld.Roster{Models: []enterworld.RosterModel{{Codename: "CHAR_TEST", RefObjID: 4321}}}
	if got := FriendModelRef(&enterworld.Deps{Roster: roster}, withRef); got != 4321 {
		t.Errorf("explicit ModelRef = %d, want 4321", got)
	}
	if got := FriendModelRef(&enterworld.Deps{}, withRef); got != 1920 {
		t.Errorf("unvalidated explicit ModelRef = %d, want the 1920 fallback", got)
	}
	fallback := &enterworld.Character{RaceIndex: &race, Gender: &female}
	if got := FriendModelRef(&enterworld.Deps{}, fallback); got != 1920 {
		t.Errorf("china female fallback = %d, want 1920", got)
	}
	if got := FriendModelRef(&enterworld.Deps{}, nil); got != 0 {
		t.Errorf("nil character = %d, want 0", got)
	}
}
