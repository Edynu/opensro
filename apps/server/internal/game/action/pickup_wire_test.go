package action

import (
	"math"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/grounditem"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

func TestGoldPickupCannotConsumeHeapBeyondDurableBalanceRange(t *testing.T) {
	c := testCharacter()
	balance := int64(math.MaxInt64 - 4)
	c.Gold = &balance
	rt, clock := newTestRuntime(c, testItems())
	key := simulation.WorldKey(testDivision, c.Name)
	pose := rt.liveSpawn(key, c.Snapshot(), clock.Now().UnixMilli())
	heap := rt.Ground.Add(testDivision, grounditem.Item{RefObjID: 62, Codename: "ITEM_ETC_GOLD_02", TypeFlags: wire.PackTypeFlags(3, 3, 5, 2), GoldAmount: 5, Position: grounditem.Point{RegionID: pose.RegionID, X: float32(pose.X), Z: float32(pose.Z)}})
	r := rt.HandleTargetInteract(testDivision, c, wire.TargetInteract{Gid: heap.Gid}.Encode())
	if *c.Gold != balance || len(r.Broadcast) != 0 {
		t.Fatal("overflow committed a partial pickup")
	}
	if _, ok := rt.Ground.Get(testDivision, heap.Gid); !ok {
		t.Fatal("overflow consumed heap")
	}
}

func TestDroppedPotionPickupPublishesCommittedStack(t *testing.T) {
	for _, existing := range []int64{0, 45} {
		t.Run(map[int64]string{0: "fresh", 45: "partial-merge"}[existing], func(t *testing.T) {
			c := testCharacter()
			flags := wire.PackTypeFlags(3, 3, 1, 1)
			row := enterworld.InventoryRow{Slot: 20, RefObjID: 3630, Codename: "ITEM_ETC_HP_POTION_01", TypeFlags: flags, StackCount: 10, VarianceBits: "0"}
			c.MissionInventory = []enterworld.InventoryRow{row}
			if existing != 0 {
				other := row
				other.Slot = 13
				other.StackCount = existing
				c.MissionInventory = append(c.MissionInventory, other)
			}
			rt, _ := newTestRuntime(c, testItems())
			dropped := rt.HandleItemMove(testDivision, c, encodeMove(t, wire.ItemMoveRequest{MovementType: wire.MoveTypeGroundDrop, SourceSlot: 20}))
			if len(dropped.Frames) == 0 {
				t.Fatal("drop failed")
			}
			ground := rt.Ground.All(testDivision)
			if len(ground) != 1 {
				t.Fatal("missing ground object", ground)
			}
			result := rt.HandleTargetInteract(testDivision, c, wire.TargetInteract{Gid: ground[0].Gid}.Encode())
			var receipt []byte
			for _, f := range result.Frames {
				if f.Opcode == wire.OpItemMoveResponse {
					receipt = f.Payload
				}
			}
			decoded, err := wire.DecodeItemMoveResult(receipt, flags)
			if err != nil {
				t.Fatalf("committed pickup cannot be decoded using its itemdata family: %x: %v", receipt, err)
			}
			want := uint16(10)
			if existing != 0 {
				want = 50
			}
			if len(receipt) != 9 || decoded.Item.Quantity != want || decoded.Item.RefObjID != 3630 {
				t.Fatalf("wrong typed stack receipt: %x %+v", receipt, decoded)
			}
			found := false
			for _, r := range c.MissionInventory {
				if r.Slot == int64(decoded.PickupSlot) {
					found = true
					if r.StackCount != int64(want) {
						t.Fatal("receipt differs from committed inventory", r)
					}
				}
			}
			if !found {
				t.Fatal("missing destination")
			}
			left, exists := rt.Ground.Get(testDivision, ground[0].Gid)
			if exists != (existing != 0) || exists && left.StackCount != 5 {
				t.Fatal("wrong ground remainder", left, exists)
			}
			if existing == 0 {
				before := c.Snapshot()
				rt.HandleTargetInteract(testDivision, c, wire.TargetInteract{Gid: ground[0].Gid}.Encode())
				if len(c.MissionInventory) != len(before.MissionInventory) || c.MissionInventory[0].StackCount != before.MissionInventory[0].StackCount {
					t.Fatal("duplicate pickup minted items")
				}
			}
		})
	}
}
