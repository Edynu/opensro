/*
===========================================================================

itemrefs_fixture_test.go - reference id lookup for quest item fixtures

Keep fixture sources consistent with the required ItemRefSource contract.
Lookups use the same records exposed by each fixture's codename lookup.

===========================================================================
*/
package quest

import "opensro.online/server/internal/game/enterworld"

/*
================
ItemRefByID
================
*/
func (items captureItems) ItemRefByID(id uint32) (*enterworld.ItemRef, bool) {
	for _, ref := range items {
		if ref != nil && ref.RefObjID == id {
			return ref, true
		}
	}
	return nil, false
}

/*
================
ItemRefByID

Synthetic fixture rows take precedence over shipped tutorial rows, just as
in ItemRefByCodename. Keep shipped lookups restricted to that fixture's names.
================
*/
func (items fakeItems) ItemRefByID(id uint32) (*enterworld.ItemRef, bool) {
	for _, code := range [...]string{
		"ITEM_QNO_CH_SPECIAL_1_01",
		"ITEM_QNO_CH_POTION_3_01",
		"ITEM_QNO_CH_GENARAL_BO_2_01",
		"ITEM_QNO_CH_FERRY2_1_01",
		"ITEM_ETC_MP_POTION_01",
		"ITEM_QNO_CH_CHEF_1",
		"ITEM_QNO_CH_SMITH_1",
		"ITEM_ETC_HP_POTION_01",
		"ITEM_QSP_ALL_POTION_1_01",
		"ITEM_QSP_ALL_POTION_1_02",
	} {
		if ref, ok := items.ItemRefByCodename(code); ok && ref.RefObjID == id {
			return ref, true
		}
	}
	ref, ok := tutorialFixtureItems().ItemRefByID(id)
	if !ok || ref == nil {
		return nil, false
	}
	switch ref.Codename {
	case "ITEM_QNO_WC_ARMOR_1", "ITEM_CH_M_LIGHT_01_AA_A", "ITEM_CH_W_LIGHT_01_AA_A", "ITEM_CH_RING_01_A":
		return ref, true
	}
	return nil, false
}
