package inventory

import "opensro.online/server/internal/game/item/wire"

// Gold heap tiers. A dropped pile spawns as one of three itemdata rows chosen
// by amount, which is what gives the drop its model (the drop_ch_money_*
// meshes). Thresholds are the itemdata param1 values.
const (
	GoldHeapSmall  = "ITEM_ETC_GOLD_01"
	GoldHeapMedium = "ITEM_ETC_GOLD_02"
	GoldHeapLarge  = "ITEM_ETC_GOLD_03"

	goldHeapMediumThreshold uint32 = 1000
	goldHeapLargeThreshold  uint32 = 10000
)

// GoldHeapTier returns the itemdata codename of the heap a gold amount drops
// as.
func GoldHeapTier(amount uint32) string {
	switch {
	case amount >= goldHeapLargeThreshold:
		return GoldHeapLarge
	case amount >= goldHeapMediumThreshold:
		return GoldHeapMedium
	default:
		return GoldHeapSmall
	}
}

// DropGold validates a type-0x0A gold ground drop against a balance and
// returns the debited balance and the amount actually dropped.
//
// The requested amount is first clamped to the native ceiling
// (wire.MaxGold), matching the client, which clamps at the head of its
// serializer before the request is ever sent. A request for nothing, or for
// more than the character holds, is refused.
func DropGold(balance uint64, requested uint32) (uint64, uint32, *Fault) {
	amount := wire.ClampGold(uint64(requested))

	if amount == 0 {
		return balance, 0, newFault(wire.ErrCodePositiveNumberOnly, "invalidGoldAmount")
	}
	if uint64(amount) > balance {
		return balance, 0, newFault(wire.ErrCodeNotEnoughGold, "insufficientGold")
	}

	return balance - uint64(amount), amount, nil
}

// PickupGold credits a picked-up gold pile onto a balance.
//
// The balance itself is not subject to the wire clamp - that ceiling applies
// to the amount carried by one operation - so this saturates at the uint64
// range rather than at wire.MaxGold.
func PickupGold(balance uint64, amount uint32) uint64 {
	credited := balance + uint64(amount)
	if credited < balance {
		return ^uint64(0)
	}
	return credited
}
