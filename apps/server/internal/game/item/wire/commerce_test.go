package wire

import (
	"bytes"
	"testing"
)

func TestCommerceRequestNativeLayouts(t *testing.T) {
	cases := []struct {
		q ItemMoveRequest
		p []byte
	}{
		{ItemMoveRequest{MovementType: MoveTypeShopBuy, ShopTab: 2, ShopSlot: 7, Quantity: 300, NpcGID: 0x12345678}, []byte{8, 2, 7, 44, 1, 120, 86, 52, 18}},
		{ItemMoveRequest{MovementType: MoveTypeShopSell, SourceSlot: 13, Quantity: 300, NpcGID: 0x12345678}, []byte{9, 13, 44, 1, 120, 86, 52, 18}},
		{ItemMoveRequest{MovementType: MoveTypeCosShopBuy, CosGID: 42, ShopTab: 2, ShopSlot: 7, Quantity: 300, NpcGID: 0x12345678}, []byte{19, 42, 0, 0, 0, 2, 7, 44, 1, 120, 86, 52, 18}},
		{ItemMoveRequest{MovementType: MoveTypeCosShopSell, CosGID: 42, SourceSlot: 2, Quantity: 300, NpcGID: 0x12345678}, []byte{20, 42, 0, 0, 0, 2, 44, 1, 120, 86, 52, 18}},
	}
	for _, c := range cases {
		p, err := c.q.Encode()
		if err != nil || !bytes.Equal(p, c.p) {
			t.Fatalf("encode %x: %x %v", c.q.MovementType, p, err)
		}
		q, err := DecodeItemMoveRequest(c.p)
		if err != nil {
			t.Fatal(err)
		}
		again, err := q.Encode()
		if err != nil || !bytes.Equal(again, c.p) {
			t.Fatalf("decode: %+v %v", q, err)
		}
		for n := 0; n < len(c.p); n++ {
			if _, err := DecodeItemMoveRequest(c.p[:n]); err == nil {
				t.Fatalf("accepted truncated %x at %d", c.q.MovementType, n)
			}
		}
		if _, err := DecodeItemMoveRequest(append(append([]byte{}, c.p...), 0)); err == nil {
			t.Fatal("accepted trailing bytes")
		}
		invalid := c.q
		invalid.Quantity = 0
		if _, err := invalid.Encode(); err == nil {
			t.Fatal("accepted zero quantity")
		}
		invalid = c.q
		invalid.NpcGID = 0
		if _, err := invalid.Encode(); err == nil {
			t.Fatal("accepted absent NPC")
		}
	}
}
