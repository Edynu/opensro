package enterworld

import "opensro.online/server/internal/domain"

// CharacterExperiencePercent derives selection presentation from the same
// within-level XP and authored threshold used by progression. A persisted
// presentation percentage is not authority and must never override these inputs.
func CharacterExperiencePercent(c *domain.Character, levels LevelDataSource) *float64 {
	if c == nil || levels == nil {
		return nil
	}
	level := int64(1)
	if c.Level != nil {
		level = *c.Level
	}
	required, ok := levels.ExpRequired(level)
	if !ok || required <= 0 {
		return nil
	}
	exp := int64(0)
	if c.Experience != nil {
		exp = *c.Experience
	}
	percent := 100 * float64(exp) / float64(required)
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	return &percent
}
