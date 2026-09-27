package action

import (
	"testing"

	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

// Native reward application is synchronous: a public combat/effect phase,
// the actor-private progression tail, and a later public action phase must
// remain in that causal order. A route-key map used to merge both public
// batches and move the latter ahead of the intervening private tail.
func TestDivisionFrameCoalescingPreservesInterleavedRouteOrder(t *testing.T) {
	in := []simulation.DivisionFrames{
		{DivisionID: testDivision, Frames: []simulation.Frame{{Opcode: wire.OpSkillCastResult}}},
		{DivisionID: testDivision, OnlyCharacterID: 7, Frames: []simulation.Frame{{Opcode: wire.OpExpUpdate}}},
		{DivisionID: testDivision, Frames: []simulation.Frame{{Opcode: wire.OpSkillEffectControl}}},
	}
	out := coalesceDivisionFrames(in)
	if len(out) != 3 {
		t.Fatalf("coalesced routes = %+v, want three causally ordered phases", out)
	}
	if out[0].Frames[0].Opcode != wire.OpSkillCastResult || out[0].OnlyCharacterID != 0 ||
		out[1].Frames[0].Opcode != wire.OpExpUpdate || out[1].OnlyCharacterID != 7 ||
		out[2].Frames[0].Opcode != wire.OpSkillEffectControl || out[2].OnlyCharacterID != 0 {
		t.Fatalf("coalesced route order = %+v, want public/open -> actor/private -> public/close", out)
	}
}

func TestDivisionFrameCoalescingJoinsOnlyAdjacentExactRoutes(t *testing.T) {
	in := []simulation.DivisionFrames{
		{DivisionID: testDivision, OnlyCharacterID: 7, Frames: []simulation.Frame{{Opcode: wire.OpBaseStats}}},
		{DivisionID: testDivision, OnlyCharacterID: 7, Frames: []simulation.Frame{{Opcode: wire.OpExpUpdate}}},
		{DivisionID: testDivision, OnlyCharacterID: 8, Frames: []simulation.Frame{{Opcode: wire.OpPointsUpdate}}},
	}
	out := coalesceDivisionFrames(in)
	if len(out) != 2 || len(out[0].Frames) != 2 || out[0].OnlyCharacterID != 7 ||
		len(out[1].Frames) != 1 || out[1].OnlyCharacterID != 8 {
		t.Fatalf("adjacent exact-route coalescing = %+v", out)
	}
}

func TestCombatResultCompositionPreservesEveryRouteCapability(t *testing.T) {
	pending := &PendingPickup{ItemGid: 55}
	prefix := OpResult{
		Frames:       []wire.Frame{{Opcode: wire.OpObjectSourceCorrection}},
		Broadcast:    []wire.Frame{{Opcode: wire.OpObjectSourceCorrection}},
		ActorPrivate: []wire.Frame{{Opcode: wire.OpBaseStats}},
	}
	tail := OpResult{
		Frames:       []wire.Frame{{Opcode: wire.OpSkillCastResult}},
		Broadcast:    []wire.Frame{{Opcode: wire.OpSkillCastResult}},
		ActorPrivate: []wire.Frame{{Opcode: wire.OpExpUpdate}},
		Pending:      pending,
	}
	result := prependOpResult(prefix, tail)
	if len(result.Frames) != 2 || result.Frames[0].Opcode != wire.OpObjectSourceCorrection ||
		result.Frames[1].Opcode != wire.OpSkillCastResult {
		t.Fatalf("actor composition = %+v", result.Frames)
	}
	if len(result.Broadcast) != 2 || result.Broadcast[0].Opcode != wire.OpObjectSourceCorrection ||
		result.Broadcast[1].Opcode != wire.OpSkillCastResult {
		t.Fatalf("public composition = %+v", result.Broadcast)
	}
	if len(result.ActorPrivate) != 2 || result.ActorPrivate[0].Opcode != wire.OpBaseStats ||
		result.ActorPrivate[1].Opcode != wire.OpExpUpdate {
		t.Fatalf("private composition = %+v", result.ActorPrivate)
	}
	if result.Pending != pending {
		t.Fatalf("pending ownership changed: got %+v want %+v", result.Pending, pending)
	}
}
