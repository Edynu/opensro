package action

import (
	"encoding/json"
	"opensro.online/server/internal/game/item/wire"
	"reflect"
	"testing"
)

func TestTaxedCommerceCreditsAndRetentionDiffer(t *testing.T) {
	rt, c := merchantFixture(t)
	if err := rt.SetCommerceTax(testDivision, 100, 20, 53, nil); err != nil {
		t.Fatal(err)
	}
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 8, NpcGID: 17, ShopSlot: 2, Quantity: 2})
	if goldOf(c) != 4856 {
		t.Fatal("taxed package purchase", goldOf(c))
	}
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 9, NpcGID: 17, SourceSlot: 13, Quantity: 2})
	if goldOf(c) != 4880 || len(c.Buyback) != 1 || c.Buyback[0].Price != 30 {
		t.Fatal("sale tax was reused as restoration discount", goldOf(c), c.Buyback)
	}
	// Later tax changes cannot reprice the retained object.
	if err := rt.SetCommerceTax(testDivision, 100, 50, 64, nil); err != nil {
		t.Fatal(err)
	}
	buyback(t, rt, c, 17, c.Buyback[0].ID)
	if goldOf(c) != 4850 || len(c.Buyback) != 0 {
		t.Fatal("retained price changed")
	}
}

func TestTaxExemptionAndCatalogUseSameAuthority(t *testing.T) {
	rt, c := merchantFixture(t)
	guild := int64(77)
	c.GuildID = &guild
	exempt := []int64{guild}
	if err := rt.SetCommerceTax(testDivision, 100, 20, 53, exempt); err != nil {
		t.Fatal(err)
	}
	exempt[0] = 88
	var catalog shopProjection
	if err := json.Unmarshal(rt.shopCatalog(testDivision, c, 17).Payload, &catalog); err != nil {
		t.Fatal(err)
	}
	if catalog.Offers[0].Price != "60" {
		t.Fatal("exempt quote", catalog)
	}
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 8, NpcGID: 17, ShopSlot: 2, Quantity: 1})
	if goldOf(c) != 4940 {
		t.Fatal("exempt charge disagrees with quote")
	}
	if err := rt.SetCommerceTax(testDivision, 100, -20, 53, []int64{guild}); err != nil {
		t.Fatal(err)
	}
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 9, NpcGID: 17, SourceSlot: 13, Quantity: 1})
	if goldOf(c) != 4958 || c.Buyback[0].Price != 18 {
		t.Fatal("exemption erased negative adjustment")
	}
}

func TestBuybackLivesWithLogicalSessionAndNotPersistedCharacter(t *testing.T) {
	rt, c := merchantFixture(t)
	rt.BeginCommerceSession(testDivision, c, 101)
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 8, NpcGID: 17, ShopSlot: 2, Quantity: 1})
	trade(t, rt, c, wire.ItemMoveRequest{MovementType: 9, NpcGID: 17, SourceSlot: 13, Quantity: 1})
	before := c.Snapshot()
	rt.BeginCommerceSession(testDivision, c, 101)
	if !reflect.DeepEqual(before, c.Snapshot()) {
		t.Fatal("duplicate entry/resume cleared retained items")
	}
	rt.EndCommerceSession(testDivision, c, 100)
	if !reflect.DeepEqual(before, c.Snapshot()) {
		t.Fatal("stale close cleared another lifetime")
	}
	data, _ := json.Marshal(c)
	var saved map[string]json.RawMessage
	json.Unmarshal(data, &saved)
	if _, exists := saved["buyback"]; exists {
		t.Fatal("ledger persisted")
	}
	rt.BeginCommerceSession(testDivision, c, 102)
	if len(c.Buyback) != 0 || c.BuybackNext != before.BuybackNext {
		t.Fatal("new lifetime retained sold objects or reused IDs")
	}
	c.Buyback = before.Buyback
	rt.EndCommerceSession(testDivision, c, 101)
	if len(c.Buyback) != 1 {
		t.Fatal("old teardown erased new owner")
	}
	rt.EndCommerceSession(testDivision, c, 102)
	if len(c.Buyback) != 0 || c.BuybackSession != 0 {
		t.Fatal("final teardown retained sold objects")
	}
}
