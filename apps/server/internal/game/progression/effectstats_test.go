/*
===========================================================================

effectstats_test.go - progression refreshes keep installed modifiers

===========================================================================
*/

package progression

import (
	"bytes"
	"errors"
	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/statuseffect"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/paramkeeper"
	"testing"
)

func TestProgressionRefreshKeepsInstalledModifiers(t *testing.T) {
	for _, operation := range []string{"strength", "intellect", "level-up"} {
		t.Run(operation, func(t *testing.T) {
			c := levelupTestCharacter()
			rt := newTestRuntime(c)
			effects := statuseffect.NewRegistry()
			modifiers, err := statuseffect.NewModifiers([]paramkeeper.Write{{Parameter: 5, Value: 1234}})
			if err != nil {
				t.Fatal(err)
			}
			if !effects.Apply(statuseffect.Effect{DivisionID: testDivision, CharacterName: c.Name, SkillID: 1, SkillGroup: 1, InstanceToken: 1, Modifiers: modifiers}) {
				t.Fatal("install")
			}
			rt.BaseStats = func(next *enterworld.Character) (wire.BaseStats, error) {
				return combat.PlayerBaseStatsWithModifiers(next, combat.Catalogs{Items: rt.deps.ItemReferences(), Skills: rt.deps.SkillData(), MagicOptions: rt.deps.MagicOptionDefinitions()}, effects.ModifierWrites(testDivision, next.Name), nil)
			}
			var result OpResult
			switch operation {
			case "strength":
				result = rt.HandleAllocStr(testDivision, c, nil)
			case "intellect":
				result = rt.HandleAllocInt(testDivision, c, nil)
			case "level-up":
				result = rt.GrantExperience(c, 118, 0, 0)
			}
			expected, err := rt.BaseStats(c.Snapshot())
			if err != nil {
				t.Fatal(err)
			}
			base, err := combat.PlayerBaseStats(c.Snapshot(), combat.Catalogs{Items: rt.deps.ItemReferences(), Skills: rt.deps.SkillData(), MagicOptions: rt.deps.MagicOptionDefinitions()})
			if err != nil || expected.PhysicalDefense == base.PhysicalDefense {
				t.Fatal("fixture did not distinguish installed buff", err)
			}
			found := false
			for _, f := range result.Frames {
				if f.Opcode == wire.OpBaseStats {
					found = true
					if !bytes.Equal(f.Payload, enterworld.BuildLoginStatBlock(c.Snapshot(), expected)) {
						t.Fatal("refresh lost installed contribution")
					}
				}
			}
			if !found {
				t.Fatal("no stat refresh", result)
			}
		})
	}
}

func TestInstalledStatProjectionFailureDoesNotSpendPoints(t *testing.T) {
	c := testCharacter()
	rt := newTestRuntime(c)
	rt.BaseStats = func(*enterworld.Character) (wire.BaseStats, error) {
		return wire.BaseStats{}, errors.New("invalid installed program")
	}
	result := rt.HandleAllocStr(testDivision, c, nil)
	if len(result.Frames) != 1 || result.Frames[0].Payload[0] != wire.ResultError || *c.StatPoints != 3 || *c.Strength != enterworld.BaseStat {
		t.Fatal("projection failure committed", result, c)
	}
}
