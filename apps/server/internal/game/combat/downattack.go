package combat

import "opensro.online/server/internal/game/enterworld"

func downAttackDamage(damage uint32, motionState uint8, modifier enterworld.SkillDownAttack) uint32 {
	if !modifier.Present || motionState != 8 {
		return damage
	}
	// 58F1B7/58F204 IMUL keeps the low dword BEFORE unsigned conversion
	// and division by 100. Widening the product changes overflow behavior.
	return (damage * modifier.Percent) / 100
}
