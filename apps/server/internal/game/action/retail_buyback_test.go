package action

import (
	"opensro.online/server/internal/game/item/wire"
	"reflect"
	"testing"
)

func TestRetailBuybackOrdinalAndNativeReceipts(t *testing.T) {
	rt, c := merchantFixture(t)
	for i := 0; i < 6; i++ {
		trade(t, rt, c, wire.ItemMoveRequest{MovementType: 8, NpcGID: 17, ShopSlot: 2, Quantity: 1})
		trade(t, rt, c, wire.ItemMoveRequest{MovementType: 9, NpcGID: 17, SourceSlot: 13, Quantity: 1})
	}
	if len(c.Buyback) != 5 || c.Buyback[0].ID != 2 {
		t.Fatal("native five-object FIFO was not preserved", c.Buyback)
	}
	r := rt.HandleRetailBuyback(testDivision, c, []byte{17, 0, 0, 0, 2})
	if len(r.Frames) != 5 || r.Frames[2].Opcode != wire.OpItemMoveResponse ||
		!reflect.DeepEqual(r.Frames[2].Payload, []byte{1, 0x22, 13, 2, 1, 0}) ||
		r.Frames[4].Opcode != 0xb7e7 || !reflect.DeepEqual(r.Frames[4].Payload, []byte{1}) {
		t.Fatalf("native restore receipts: %+v", r)
	}
	for _, e := range c.Buyback {
		if e.ID == 4 {
			t.Fatal("wrong sold object restored")
		}
	}
	if c.Buyback[2].ID != 5 {
		t.Fatal("list ordinal did not shift after removal")
	}
}

func TestRetailBuybackRefusalAndLegacyLedgerDoNotResurrectEvictions(t *testing.T) {
	rt, c := merchantFixture(t)
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 8, NpcGID: 17, ShopSlot: 2, Quantity: 1})
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 9, NpcGID: 17, SourceSlot: 13, Quantity: 1})
	e := c.Buyback[0]
	c.Buyback = nil
	for id := uint32(1); id <= 32; id++ {
		row := e
		row.ID = id
		c.Buyback = append(c.Buyback, row)
	}
	c.BuybackNext = 32
	before := c.Snapshot()
	for _, p := range [][]byte{{17, 0, 0, 0}, {17, 0, 0, 0, 0, 0}, {17, 0, 0, 0, 5}, {18, 0, 0, 0, 0}} {
		rt.HandleRetailBuyback(testDivision, c, p)
		if !reflect.DeepEqual(before, c.Snapshot()) {
			t.Fatal("refusal mutated character")
		}
	}
	r := rt.HandleRetailBuyback(testDivision, c, []byte{17, 0, 0, 0, 0})
	if len(r.Frames) != 5 || len(c.Buyback) != 4 || c.Buyback[0].ID != 29 {
		t.Fatal("evicted legacy objects resurfaced", c.Buyback)
	}
}
