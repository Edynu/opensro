package combat

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
)

// 59E750/59E770 read the live mastery dictionary, not setv or buff state.
func masteryEnhancement(masteries []domain.CharacterMastery, attack enterworld.SkillAttack) uint8 {
	if !attack.MasteryEnhancement {
		return 0
	}
	var result uint8
	for _, id := range attack.MasteryIDs {
		level := uint8(1)
		if id != 0 {
			level = 0
			for _, m := range masteries {
				if m.ID == id {
					level = uint8(m.Level)
					break
				}
			}
		}
		if level > result {
			result = level
		}
	}
	return result
}
