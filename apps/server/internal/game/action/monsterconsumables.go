package action

import (
	"time"

	"opensro.online/server/internal/game/item/grounditem"
	"opensro.online/server/internal/game/item/inventory"
	"opensro.online/server/internal/game/item/loot"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

func (rt *Runtime) prepareConsumableDrop(mob monster.Instance, family int, at simulation.Spawn, owner string, now time.Time) (grounditem.Item, bool) {
	_, _, attempts := loot.MonsterDropBudget(mob.Rarity(), mob.Ref.Codename)
	for attempt := 0; attempt < attempts; attempt++ {
		v, ok := rt.rollCombinedMillion()
		if !ok {
			return grounditem.Item{}, false
		}
		chosen, ok := loot.SelectConsumable(family, mob.Ref.Level, v, rt.DropRoll)
		if ok {
			return rt.prepareSelectedDrop(chosen, at, owner, now)
		}
	}
	return grounditem.Item{}, false
}

func (rt *Runtime) prepareSelectedDrop(chosen loot.DropItem, at simulation.Spawn, owner string, now time.Time) (grounditem.Item, bool) {
	items := rt.deps.ItemReferences()
	if items == nil || chosen.Count == 0 {
		return grounditem.Item{}, false
	}
	ref, ok := items.ItemRefByCodename(chosen.Codename)
	if !ok || ref == nil {
		return grounditem.Item{}, false
	}
	row := inventory.Item{RefObjID: ref.RefObjID, Codename: ref.Codename, TypeFlags: ref.TypeFlags(), Quantity: chosen.Count, Plus: chosen.Plus}
	if ref.TypeIDs[1] == 1 {
		variance, durability, ok := rt.rollDroppedEquipmentVariance(ref)
		if !ok {
			return grounditem.Item{}, false
		}
		row.VarianceBits, row.Durability = variance, durability
	}
	return PlanItemDrop(row, chosen.Count, at, owner, now), true
}
