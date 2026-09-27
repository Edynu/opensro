package action

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestRewardRecipientRoutingRetainsDeliveryLifetime(t *testing.T) {
	live := true
	input := wire.Frame{Opcode: 0x30d2, Payload: []byte{1}, Current: func() bool { return live }, Scope: []domain.ObjectScopeChange{{GID: 400001, Visible: true}}}
	batches := recipientDivisionFrames("division", []RecipientFrames{{CharacterID: 7, Frames: []wire.Frame{input}}})
	if len(batches) != 1 || batches[0].OnlyCharacterID != 7 || batches[0].DivisionID != "division" || len(batches[0].Frames) != 1 {
		t.Fatalf("recipient identity lost: %+v", batches)
	}
	frame := batches[0].Frames[0]
	if frame.Current == nil || !frame.Current() || len(frame.Scope) != 1 || frame.Scope[0] != input.Scope[0] {
		t.Fatal("delivery metadata lost during reward routing")
	}
	live = false
	if frame.Current() {
		t.Fatal("retired producer remained deliverable")
	}
}

func TestDeferredCastControlsPreserveSourceAndPhaseOrder(t *testing.T) {
	rt, _ := newTestRuntime(testCharacter(), testItems())
	live := true
	release := wire.SkillCastReleaseFrame(101, 0)
	release.Current = func() bool { return live }
	rt.queueSkillFinalize(testDivision, "a", 11, 50, release)
	rt.queueSkillFinalize(testDivision, "b", 22, 50, wire.SkillCastFinalizeFrame(202))
	rt.queueSkillFinalize(testDivision, "a", 11, 50, wire.SkillCastFinalizeFrame(101))
	got := rt.drainSkillFinalizes(50)
	if len(got) != 3 {
		t.Fatalf("source/phase batches collapsed: %+v", got)
	}
	for i, gid := range []uint32{11, 22, 11} {
		if got[i].SourceGID != gid || len(got[i].Frames) != 1 {
			t.Fatalf("route %d: %+v", i, got[i])
		}
	}
	if got[0].Frames[0].Payload[0] != 1 || got[2].Frames[0].Payload[0] != 2 {
		t.Fatal("release/finalize order changed")
	}
	if got[0].Frames[0].Current == nil || !got[0].Frames[0].Current() {
		t.Fatal("deferred release lost delivery guard")
	}
	live = false
	if got[0].Frames[0].Current() {
		t.Fatal("retired deferred release remained deliverable")
	}
	if len(rt.drainSkillFinalizes(50)) != 0 {
		t.Fatal("controls emitted twice")
	}
}

func TestCastControlsRetireWithTheirOwner(t *testing.T) {
	rt, _ := newTestRuntime(testCharacter(), testItems())
	rt.queueSkillFinalize(testDivision, "leaving", 11, 50, wire.SkillCastReleaseFrame(101, 0))
	rt.queueSkillFinalize(testDivision, "staying", 22, 50, wire.SkillCastFinalizeFrame(202))
	rt.clearSkillFinalizes(testDivision, "leaving")
	got := rt.drainSkillFinalizes(50)
	if len(got) != 1 || got[0].SourceGID != 22 {
		t.Fatalf("retired source retained controls or removed another owner: %+v", got)
	}
	if rt.hasOpenSkillCast(testDivision, "leaving") {
		t.Fatal("retired cast blocks a replacement owner")
	}
}

func TestCastControlCannotFallBackToDivisionBroadcast(t *testing.T) {
	rt, _ := newTestRuntime(testCharacter(), testItems())
	defer func() {
		if recover() == nil {
			t.Fatal("source-less cast control admitted")
		}
		if len(rt.drainSkillFinalizes(100)) != 0 {
			t.Fatal("invalid control reached the queue")
		}
	}()
	rt.queueSkillFinalize(testDivision, "invalid", 0, 50, wire.SkillCastFinalizeFrame(101))
}
