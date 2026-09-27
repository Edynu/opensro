package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/inventory"
)

// ammunitionTid4ForWeapon is the native equipment-family join. Item TID4 6
// is a Chinese bow and consumes arrow TID 3.3.4.1; weapon TID4 12 is a
// European crossbow and consumes bolt TID 3.3.4.2. Both live in equipment
// socket 7, the same socket the client refreshes through opcode 0x3752.
func ammunitionTid4ForWeapon(weaponKind uint8) (int64, bool) {
	switch weaponKind {
	case 6:
		return 1, true
	case 12:
		return 2, true
	default:
		return 0, false
	}
}

// ammunitionSpent is SkillAction_Projectile's debit (585AF0 / 585FB6): a
// skill spends its cnsm count once per mc impact; a basic shot spends one.
// planEquippedAmmunition floors the stack at 0, so a last arrow still pays
// for a shot that asks for more.
func ammunitionSpent(skill enterworld.SkillRow, advanced bool) int64 {
	if !advanced {
		return 1
	}
	return int64(skill.Ammunition.Count) * int64(max(1, skill.Attack.ImpactCount))
}

type ammunitionDebit struct {
	index     int
	remaining int64
}

// planEquippedAmmunition validates the live equipment row without changing
// it. Damage is admitted after this plan is built; applying the plan is then
// the final, non-refusing step of the combined character/monster transition.
// This ordering matters because enterworld.Update deliberately does not roll
// a callback back when it returns false.
func (rt *Runtime) planEquippedAmmunition(character *enterworld.Character, weaponKind uint8, spent int64) (ammunitionDebit, bool) {
	wantTid4, required := ammunitionTid4ForWeapon(weaponKind)
	if !required {
		return ammunitionDebit{index: -1}, true
	}
	items := rt.deps.ItemReferences()
	if character == nil || items == nil {
		return ammunitionDebit{}, false
	}
	for index := range character.MissionInventory {
		row := character.MissionInventory[index]
		if row.Slot != int64(inventory.SocketShield) || row.StackCount < 1 || row.StackCount > 0xffff {
			continue
		}
		ref, ok := items.ItemRefByCodename(row.Codename)
		if !ok || ref == nil || ref.RefObjID != row.RefObjID ||
			ref.TypeIDs != [4]int64{3, 3, 4, wantTid4} ||
			(row.TypeFlags != 0 && row.TypeFlags != ref.TypeFlags()) {
			return ammunitionDebit{}, false
		}
		return ammunitionDebit{index: index, remaining: max(0, row.StackCount-max(1, spent))}, true
	}
	return ammunitionDebit{}, false
}

// applyAmmunitionDebit performs the already-validated, non-refusing tail of
// the attack commit and returns the absolute count expected by opcode 0x3752.
func applyAmmunitionDebit(character *enterworld.Character, debit ammunitionDebit) uint16 {
	if debit.remaining == 0 {
		character.MissionInventory = append(
			character.MissionInventory[:debit.index:debit.index],
			character.MissionInventory[debit.index+1:]...,
		)
	} else {
		character.MissionInventory[debit.index].StackCount = debit.remaining
	}
	return uint16(debit.remaining)
}
