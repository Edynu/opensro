/*
===========================================================================

mastery_test.go - tests for mastery.go

===========================================================================
*/

package combat

import (
	"encoding/json"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"testing"
)

func TestMasteryEnhancementBindingAndAbsentSlots(t *testing.T) {
	learned := []domain.CharacterMastery{{ID: 257, Level: 30}, {ID: 258, Level: 50}}
	for _, c := range []struct {
		enabled bool
		ids     [2]uint32
		want    uint8
	}{
		{false, [2]uint32{257, 258}, 0}, {true, [2]uint32{}, 1}, {true, [2]uint32{257, 0}, 30},
		{true, [2]uint32{257, 258}, 50}, {true, [2]uint32{999, 0}, 1}, {true, [2]uint32{999, 998}, 0},
	} {
		if got := masteryEnhancement(learned, enterworld.SkillAttack{MasteryEnhancement: c.enabled, MasteryIDs: c.ids}); got != c.want {
			t.Fatalf("%+v got %d", c, got)
		}
	}
}
func TestMasteryEnhancementChangesBothDamageLanesOnlyWhenBound(t *testing.T) {
	a := Stats{Level: 1, PhysicalAttackMin: 100, PhysicalAttackMax: 100, MagicalAttackMin: 100, MagicalAttackMax: 100, masteries: []domain.CharacterMastery{{ID: 257, Level: 50}}}
	for _, flags := range []uint32{4, 8} {
		for _, bound := range []bool{false, true} {
			attack := enterworld.SkillAttack{Present: true, Flags: flags, Percent: 100, MasteryEnhancement: bound, MasteryIDs: [2]uint32{257, 0}}
			got, err := ResolveMonster(a, Stats{Level: 1}, attack, func() (uint32, error) { return 0, nil })
			want := uint32(100)
			if bound {
				want = 150
			}
			if err != nil || got.Damage != want {
				t.Fatalf("flags%d bound%v got%+v err%v", flags, bound, got, err)
			}
		}
	}
}

func TestMasterySnapshotDetachesAndRestores(t *testing.T) {
	c := &domain.Character{Level: pointer(30), Strength: pointer(49), Intellect: pointer(49), Masteries: []domain.CharacterMastery{{ID: 257, Level: 30}}}
	before, _, err := PlayerStats(c, Catalogs{Items: itemRefs{}})
	if err != nil {
		t.Fatal(err)
	}
	attack := enterworld.SkillAttack{MasteryEnhancement: true, MasteryIDs: [2]uint32{257, 0}}
	c.Masteries[0].Level = 50
	if masteryEnhancement(before.masteries, attack) != 30 {
		t.Fatal("snapshot aliases authority")
	}
	encoded, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored domain.Character
	if err = json.Unmarshal(encoded, &restored); err != nil {
		t.Fatal(err)
	}
	after, _, err := PlayerStats(&restored, Catalogs{Items: itemRefs{}})
	if err != nil || masteryEnhancement(after.masteries, attack) != 50 {
		t.Fatal("reconnect lost mastery", err)
	}
	restored.Masteries = nil
	removed, _, err := PlayerStats(&restored, Catalogs{Items: itemRefs{}})
	if err != nil || masteryEnhancement(removed.masteries, attack) != 1 {
		t.Fatal("removed mastery persisted", err)
	}
}
