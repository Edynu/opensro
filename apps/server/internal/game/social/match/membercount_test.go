package match

import (
	"testing"

	"opensro.online/server/internal/game/enterworld"
)

// TestPartyMemberCountSeam pins the MemberCountFor seam semantics: nil
// (server.go not yet wired, or a transport-less test) and any answer
// below 1 fall back to the client's own no-active-party fallback of 1;
// a live count rides the u8 unchanged; an impossible over-byte answer
// clamps instead of wrapping the wire field.
func TestPartyMemberCountSeam(t *testing.T) {
	character := &enterworld.Character{Name: "seamHero"}
	request := PartyMatchRequest{PartyNumber: 42, TypeBits: 1, Purpose: 2, MinLevel: 10, MaxLevel: 60, Title: "seam"}

	nilSeam := NewRuntime(&enterworld.Deps{}, nil)
	if got := nilSeam.partyEntryFromRequest("global-official", character, request).MemberCount; got != 1 {
		t.Fatalf("nil seam member count = %d, want the fallback 1", got)
	}

	live := NewRuntime(&enterworld.Deps{}, nil)
	live.MemberCountFor = func(divisionID, name string) int {
		if divisionID != "global-official" || name != "seamHero" {
			t.Fatalf("seam asked for %s / %s", divisionID, name)
		}
		return 4
	}
	if got := live.partyEntryFromRequest("global-official", character, request).MemberCount; got != 4 {
		t.Fatalf("live seam member count = %d, want 4", got)
	}

	floor := NewRuntime(&enterworld.Deps{}, nil)
	floor.MemberCountFor = func(string, string) int { return 0 }
	if got := floor.partyMemberCount("global-official", "seamHero"); got != 1 {
		t.Fatalf("zero answer member count = %d, want the fallback 1", got)
	}

	clamp := NewRuntime(&enterworld.Deps{}, nil)
	clamp.MemberCountFor = func(string, string) int { return 300 }
	if got := clamp.partyMemberCount("global-official", "seamHero"); got != 0xFF {
		t.Fatalf("over-byte answer member count = %d, want the 0xFF clamp", got)
	}
}
