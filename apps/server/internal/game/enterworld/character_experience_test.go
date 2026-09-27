package enterworld

import (
	"math"
	"opensro.online/server/internal/domain"
	"testing"
)

type rosterLevels map[int64]int64

func (l rosterLevels) ExpRequired(level int64) (int64, bool) { v, ok := l[level]; return v, ok }
func (l rosterLevels) SkillPointCost(int64) (int64, bool)    { return 0, false }
func (l rosterLevels) MonsterExpBasis(int64) (int64, bool)   { return 0, false }

func TestCharacterExperiencePercentUsesCurrentAuthority(t *testing.T) {
	level, exp, stale := int64(2), int64(40), float64(99)
	c := &domain.Character{Level: &level, Experience: &exp, ExperiencePercent: &stale}
	levels := rosterLevels{1: 118, 2: 470, 3: 1058, 140: 34900085783}
	for _, row := range []struct {
		level, exp int64
		want       float64
	}{{2, 40, 100.0 * 40 / 470}, {2, 235, 50}, {3, 12, 100.0 * 12 / 1058}, {140, 17450042891, 100.0 * 17450042891 / 34900085783}, {1, 0, 0}, {1, -1, 0}, {1, 200, 100}} {
		level, exp = row.level, row.exp
		got := CharacterExperiencePercent(c, levels)
		if got == nil || math.Abs(*got-row.want) > 1e-9 {
			t.Fatalf("level %d exp %d: %v want %v", level, exp, got, row.want)
		}
	}
	if stale != 99 {
		t.Fatal("projection mutated durable data")
	}
	level = 141
	if CharacterExperiencePercent(c, levels) != nil {
		t.Fatal("missing threshold invented a percentage")
	}
	if CharacterExperiencePercent(c, nil) != nil {
		t.Fatal("missing table invented a percentage")
	}
	if got := CharacterExperiencePercent(&domain.Character{}, levels); got == nil || *got != 0 {
		t.Fatal("new character should have zero XP")
	}
}
