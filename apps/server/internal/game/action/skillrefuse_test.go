package action

import (
	"testing"

	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

// The 0x72CD wrong-conversation guard. History
// of this fence, both stages witnessed red:
//   - before the IsSkillActionPayload branch (landing 3), skill payloads
//     fell into DecodeTargetInteract's error path and answered the noisy
//     pickup refusal pair (0xB2CD release + 0xB06D invalid-request) - a
//     wrong conversation that desyncs the pickup latch;
//   - the silent-refuse era ended with the accept landing (landing 1 of the
//     "Server accept" plan, 2026-07-28): recognised casts now answer the
//     timed 0xB245+0xB505 bracket (skillaccept_test.go owns those assertions).
//
// What must stay true FOREVER on the skill path, and is pinned here:
// no 0xB2CD, no 0xB06D, no pickup frame of any kind - skill bytes never
// speak pickup.
func TestSkillActionOn72CDNeverAnswersThePickupConversation(t *testing.T) {
	skillForms := map[string][]byte{
		"no-target":   wire.SkillAction{ActionId: 0x1234}.Encode(),
		"with-target": wire.SkillAction{ActionId: 0xABCD, HasTarget: true, TargetGid: 300001}.Encode(),
		"ground-location": wire.SkillAction{ActionId: 0x5678, HasGroundTarget: true,
			Region: 0x62A8, GroundX: 960, GroundY: 20, GroundZ: 458}.Encode(),
	}
	pickupOpcodes := map[uint16]string{
		wire.OpActionState:      "0xB2CD action-state release",
		wire.OpItemMoveResponse: "0xB06D item-move response",
		wire.OpPickupAnim:       "0x35C7 pickup anim",
		wire.OpObjectDespawn:    "0x36AB despawn",
	}
	for name, payload := range skillForms {
		t.Run(name, func(t *testing.T) {
			character := testCharacter()
			rt, _ := newTestRuntime(character, testItems())

			result := rt.HandleTargetInteract(testDivision, character, payload)
			if result.Pending != nil {
				t.Fatalf("skill-action armed a pickup pending %+v", result.Pending)
			}
			for _, frame := range append(append([]wire.Frame{}, result.Frames...), result.Broadcast...) {
				if label, isPickup := pickupOpcodes[frame.Opcode]; isPickup {
					t.Fatalf("skill-action answered %s - the wrong conversation", label)
				}
			}
		})
	}
}

// Adversarial pin: a skill-action whose target gid names a real ground item
// must not grant, arm an approach, despawn the drop, or receive a visual-only
// combat success. Skill bytes never buy items, and only a simulation-owned live
// monster can enter the authoritative cast lane.
func TestSkillActionTargetingAGroundItemDoesNotGrantIt(t *testing.T) {
	character := testCharacter()
	rt, clock := newTestRuntime(character, testItems())

	start := simulation.SeedWorldState(character).Spawn
	heap := rt.Ground.Add(testDivision, PlanGoldDrop(
		GoldHeapRef{RefObjID: 62, Codename: "ITEM_ETC_GOLD_02", Tid1: 3, Tid2: 3, Tid3: 5, Tid4: 2},
		777,
		simulation.Spawn{RegionID: start.RegionID, X: start.X, Y: start.Y, Z: start.Z}, // underfoot
		"someone", clock.Now()))

	goldBefore := *character.Gold
	skill := wire.SkillAction{ActionId: 0x1234, HasTarget: true, TargetGid: heap.Gid}.Encode()

	result := rt.HandleTargetInteract(testDivision, character, skill)
	if len(result.Frames) != 0 || len(result.Broadcast) != 0 {
		t.Fatalf("skill at a ground-item gid answered %+v, want silent combat refusal", result)
	}
	if result.Pending != nil {
		t.Fatalf("skill at item gid armed a pickup pending %+v", result.Pending)
	}
	if rt.Ground.Count(testDivision) != 1 {
		t.Fatal("the skill-action consumed the ground item")
	}
	if *character.Gold != goldBefore {
		t.Fatalf("gold moved %d -> %d on a skill-action", goldBefore, *character.Gold)
	}

	// The same gid over the PICKUP form still grants - the multiplex branch
	// did not eat the legitimate lane.
	grant := rt.HandleTargetInteract(testDivision, character,
		wire.TargetInteract{Gid: heap.Gid}.Encode())
	if len(grant.Frames) == 0 {
		t.Fatal("pickup after the accepted skill-action went silent")
	}
	if rt.Ground.Count(testDivision) != 0 {
		t.Fatal("underfoot pickup did not consume the heap")
	}
}
