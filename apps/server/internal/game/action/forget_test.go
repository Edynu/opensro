package action

// Session-close cleanup: ForgetCharacter is the ONE path that releases the
// per-character runtime planes (world state, combat intent, pickup approach,
// object selection). Without it every character
// who ever moved or dropped an item leaks a WorldStore entry for the life of
// the process.

import (
	"opensro.online/server/internal/game/enterworld"
	"testing"
	"time"

	"opensro.online/server/internal/game/item/grounditem"
	"opensro.online/server/internal/game/item/statuseffect"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

func TestForgetCharacterReleasesPerCharacterPlanes(t *testing.T) {
	character := testCharacter()
	rt, clock := newTestRuntime(character, testItems())

	// Populate all three per-character planes plus one division drop.
	installMidMove(rt, character, clock)
	pendingKey := grounditem.PendingKey(testDivision, character.Name)
	rt.Pending.Arm(pendingKey, 300001, clock.Now().Add(time.Second))
	rt.Selected.Set(testDivision, character.Name, 300001)
	rt.effects.Apply(statuseffect.Effect{
		DivisionID: testDivision, CharacterName: character.Name,
		SkillID: 100, SkillGroup: 9, InstanceToken: 44,
		State: statuseffect.StateActive, ClientCancelable: true,
	})
	dropped := rt.Ground.Add(testDivision, grounditem.Item{RefObjID: 777})

	rt.ForgetCharacter(testDivision, character.Name)

	// The world entry is gone: a fresh snapshot re-seeds from the record
	// instead of returning the runtime segment installMidMove left behind.
	worldKey := simulation.WorldKey(testDivision, character.Name)
	reseeded := rt.Worlds.Snapshot(worldKey, func() simulation.WorldState { return simulation.SeedWorldState(character) })
	if reseeded.MoveSegment != nil {
		t.Fatal("the forgotten world entry survived: the snapshot still carries the runtime segment")
	}
	if _, armed := rt.Pending.Peek(pendingKey); armed {
		t.Fatal("the pending pickup approach survived ForgetCharacter")
	}
	if _, ok := rt.Selected.Get(testDivision, character.Name); ok {
		t.Fatal("the object selection survived ForgetCharacter")
	}
	if rows := rt.effects.Snapshot(testDivision, character.Name); len(rows) != 0 {
		t.Fatalf("active effects survived ForgetCharacter: %+v", rows)
	}
	// Division-scoped state stays: drops outlive the dropper.
	if _, ok := rt.Ground.Get(testDivision, dropped.Gid); !ok {
		t.Fatal("ForgetCharacter reaped a division ground drop")
	}

	// Idempotent: a double close is a no-op, not a fault.
	rt.ForgetCharacter(testDivision, character.Name)
}

// The store keys fold the character name to lower case (WorldKey); the
// cleanup must remove the entry whatever casing the closer resolves.
func TestForgetCharacterKeyFoldsCase(t *testing.T) {
	character := testCharacter()
	rt, clock := newTestRuntime(character, testItems())
	installMidMove(rt, character, clock)

	rt.ForgetCharacter(testDivision, "ASD2")

	worldKey := simulation.WorldKey(testDivision, character.Name)
	reseeded := rt.Worlds.Snapshot(worldKey, func() simulation.WorldState { return simulation.SeedWorldState(character) })
	if reseeded.MoveSegment != nil {
		t.Fatal("an upper-cased close left the lower-cased world entry behind")
	}
}

func TestForgetCharacterRetiresOpenSkillBracket(t *testing.T) {
	character := testCharacter()
	rt, clock := newTestRuntime(character, testItems())
	dueAtMs := clock.Now().Add(time.Second).UnixMilli()
	rt.queueSkillFinalize(
		testDivision,
		character.Name,
		enterworld.ObjectIDForCharacter(character),
		dueAtMs,
		wire.SkillCastFinalizeFrame(0x12345678),
	)
	if !rt.hasOpenSkillCast(testDivision, "ASD2") {
		t.Fatal("case-folded action owner was not visible before disconnect")
	}

	rt.ForgetCharacter(testDivision, "ASD2")

	if rt.hasOpenSkillCast(testDivision, character.Name) {
		t.Fatal("the disconnected character's B245 action bracket survived cleanup")
	}
	for _, routed := range rt.TickHook()(dueAtMs + 1) {
		for _, frame := range routed.Frames {
			if frame.Opcode == wire.OpSkillEffectControl {
				t.Fatal("a stale B505 escaped after its owning character disconnected")
			}
		}
	}
}
