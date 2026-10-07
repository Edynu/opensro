/*
===========================================================================

cosground_test.go - pet inventory ownership, pickup arrival and gold routing

===========================================================================
*/
package action

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/grounditem"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
	"reflect"
	"testing"
	"time"
)

/*
================
TestCOSGroundRoundTripAndOwnership

The native pet arrives at 2200; the port-only pacing policy slows it to 2500.
================
*/
func TestCOSGroundRoundTripAndOwnership(t *testing.T) {
	for _, paced := range []bool{false, true} {
		t.Run(map[bool]string{false: "native", true: "paced"}[paced], func(t *testing.T) {
			cosGroundRoundTrip(t, paced)
		})
	}
}

/*
================
cosGroundRoundTrip
================
*/
func cosGroundRoundTrip(t *testing.T, paced bool) {
	arrivalMs := int64(2200)
	if paced {
		arrivalMs = 2500
	}
	c := testCharacter()
	refs := testCosSource(testItems())
	refs.characters["PET"] = &enterworld.CharacterRef{Codename: "PET", RefObjID: 9, TidWord: 0x21c6, RunSpeed: 100}
	rt, _ := newTestRuntime(c, refs)
	rt.PetPolicies.Pacing = paced
	rt.Now = func() time.Time { return time.UnixMilli(1000) }
	gid, _ := enterworld.CosObjectIDForCharacter(c)
	row := c.MissionInventory[0]
	row.Slot = 0
	c.ActiveCOS = &enterworld.CharacterCOS{GID: gid, RefObjID: 9, Codename: "PET", CurrentHP: 100, Summoned: true, Container: &domain.COSContainer{Capacity: 2, Rows: []domain.InventoryRow{row}}}
	rt.ConstrainMovement = func(_ string, from, to simulation.Spawn) (simulation.Spawn, *simulation.MoveError) { return to, nil }
	rt.BindPetSession(testDivision, c, 1)
	rt.TickHook()(1000)
	bag := c.Snapshot().MissionInventory
	send := func(q wire.ItemMoveRequest) OpResult {
		p, e := q.Encode()
		if e != nil {
			t.Fatal(e)
		}
		return rt.HandleItemMove(testDivision, c, p)
	}
	if r := send(wire.ItemMoveRequest{MovementType: wire.MoveTypeCosDrop, CosGID: gid + 1, SourceSlot: 0}); r.Frames[0].Payload[0] != 2 {
		t.Fatal("foreign drop admitted")
	}
	r := send(wire.ItemMoveRequest{MovementType: wire.MoveTypeCosDrop, CosGID: gid, SourceSlot: 0})
	if r.Frames[0].Payload[0] != 1 || len(c.ActiveCOS.Container.Rows) != 0 || len(rt.Ground.All(testDivision)) != 1 {
		t.Fatal("drop failed", r)
	}
	ground := rt.Ground.All(testDivision)[0]
	q := wire.ItemMoveRequest{MovementType: wire.MoveTypeCosPickup, CosGID: gid, GroundGID: ground.Gid}
	r = send(q)
	if r.Frames[0].Payload[0] != 1 || len(rt.Ground.All(testDivision)) != 0 || !reflect.DeepEqual(c.ActiveCOS.Container.Rows, []domain.InventoryRow{row}) || !reflect.DeepEqual(c.MissionInventory, bag) {
		t.Fatal("roundtrip changed owner or item", r, c.ActiveCOS.Container.Rows)
	}
	if r = send(q); r.Frames[0].Payload[0] != 2 {
		t.Fatal("duplicate pickup granted")
	}
	// Drop again, move only the ground target, and require pet arrival rather
	// than borrowing the owner's position or granting on the request tick.
	send(wire.ItemMoveRequest{MovementType: wire.MoveTypeCosDrop, CosGID: gid, SourceSlot: 0})
	old := rt.Ground.All(testDivision)[0]
	rt.Ground.Remove(testDivision, old.Gid)
	old.Position.X += 100
	far := rt.Ground.Add(testDivision, old)
	q.GroundGID = far.Gid
	if r = send(q); len(r.Frames) != 0 || len(c.ActiveCOS.Container.Rows) != 0 {
		t.Fatal("far pickup did not wait")
	}
	rt.TickHook()(1100)
	if len(c.ActiveCOS.Container.Rows) != 0 {
		t.Fatal("pickup granted before arrival")
	}
	if paced {
		rt.TickHook()(2200)
		if len(c.ActiveCOS.Container.Rows) != 0 {
			t.Fatal("slower pet granted pickup before arrival")
		}
	}
	rt.TickHook()(arrivalMs)
	if len(c.ActiveCOS.Container.Rows) != 1 || len(rt.Ground.All(testDivision)) != 0 || !reflect.DeepEqual(c.MissionInventory, bag) {
		t.Fatal("arrival failed to grant into COS")
	}
	rt.Now = func() time.Time { return time.UnixMilli(arrivalMs) }
	pose := rt.PetPresentation(testDivision, c.Name).World.LiveSpawnAt(arrivalMs)
	heap := rt.Ground.Add(testDivision, grounditem.Item{GoldAmount: 50, Position: grounditem.Point{RegionID: pose.RegionID, X: float32(pose.X), Z: float32(pose.Z)}, OwnerJID: 999})
	q.GroundGID = heap.Gid
	before := goldOf(c)
	if r = send(q); r.Frames[0].Payload[0] != 2 || goldOf(c) != before {
		t.Fatal("foreign reservation consumed")
	}
	rt.Ground.Remove(testDivision, heap.Gid)
	heap.OwnerJID = 0
	heap = rt.Ground.Add(testDivision, heap)
	q.GroundGID = heap.Gid
	c.ActiveCOS.Container.Capacity = 1
	if r = send(q); r.Frames[0].Payload[0] != 1 || r.Frames[0].Payload[6] != wire.PickupGoldSlot || goldOf(c) != before+50 || len(c.ActiveCOS.Container.Rows) != 1 {
		t.Fatal("gold pickup required an empty slot or corrupted bag", r)
	}
}
