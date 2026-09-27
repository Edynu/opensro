package domain

// BaseStat is the character-creation STR/INT value.
const BaseStat int64 = 20

// BaseVitals is the character-creation HP/MP value. It is also the result of
// the runtime vitality formula at level 1 with BaseStat.
const BaseVitals int64 = 200

// CharacterMastery is one learned mastery and its trained level.
type CharacterMastery struct {
	ID    uint32 `json:"id"`
	Level int64  `json:"level"`
}

var (
	chMasteryIDs = []uint32{257, 258, 259, 273, 274, 275, 276}
	euMasteryIDs = []uint32{513, 514, 515, 516, 517, 518}
)

// MasterySeedLevel is the native creation level for every racial mastery.
const MasterySeedLevel int64 = 0

// DefaultMasteries returns the complete racial creation set.
func DefaultMasteries(raceKey string) []CharacterMastery {
	ids := euMasteryIDs
	if raceKey == RaceKeyChina {
		ids = chMasteryIDs
	}
	masteries := make([]CharacterMastery, len(ids))
	for index, id := range ids {
		masteries[index] = CharacterMastery{
			ID:    id,
			Level: MasterySeedLevel,
		}
	}
	return masteries
}

// SkillLearned reports whether the exact skill is learned.
func SkillLearned(character *Character, skillID uint32) bool {
	if character == nil {
		return false
	}
	for _, id := range character.Skills {
		if id == skillID {
			return true
		}
	}
	return false
}

// MasteryLevel returns a mastery level and whether the mastery exists.
func MasteryLevel(character *Character, masteryID uint32) (int64, bool) {
	if character == nil {
		return 0, false
	}
	for _, mastery := range character.Masteries {
		if mastery.ID == masteryID {
			return mastery.Level, true
		}
	}
	return 0, false
}

// CharacterStrength returns the authoritative stat with the creation fallback
// used by detached fixtures.
func CharacterStrength(character *Character) int64 {
	if character == nil ||
		character.Strength == nil ||
		*character.Strength < 0 {
		return BaseStat
	}
	return *character.Strength
}

// CharacterIntellect returns the authoritative stat with the same fallback.
func CharacterIntellect(character *Character) int64 {
	if character == nil ||
		character.Intellect == nil ||
		*character.Intellect < 0 {
		return BaseStat
	}
	return *character.Intellect
}
