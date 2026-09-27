package action

import (
	"reflect"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/statuseffect"
	"opensro.online/server/internal/game/paramkeeper"
)

// Consumer qualification only: the fixture installs a contribution directly;
// it does not claim an authored timed-defense skill is admitted yet.
func TestInstalledModifiersReachMonsterDamageAndCharacterStats(t *testing.T) {
	measure := func(withModifier bool) int64 {
		t.Helper()
		rt, clock, c, instance := newCombatTestRuntime(t, 100000)
		c.CurrentHP = testInt64(100000)
		instance.Ref.DefaultSkillIDs[0] = 2
		skills := rt.deps.SkillData().(staticSkillSource)
		skill := skills[2]
		skill.Attack.Min, skill.Attack.Max, skill.Attack.Percent = 100, 100, 100
		skills[2] = skill
		base, err := rt.PlayerBaseStats(testDivision, c)
		if err != nil {
			t.Fatal(err)
		}
		if withModifier {
			m, err := statuseffect.NewModifiers([]paramkeeper.Write{{Parameter: 5, Value: 10000}, {Parameter: 6, Value: 10000}})
			if err != nil {
				t.Fatal(err)
			}
			if !rt.effects.Apply(statuseffect.Effect{DivisionID: testDivision, CharacterName: c.Name, SkillID: 99, SkillGroup: 99, InstanceToken: 900, ClientCancelable: true, Modifiers: m}) {
				t.Fatal("install")
			}
			display, err := rt.PlayerBaseStats(testDivision, c)
			if err != nil || display.PhysicalDefense <= base.PhysicalDefense {
				t.Fatal("UI omitted effect", display, err)
			}
			foreign, err := rt.PlayerBaseStats("another-division", c)
			if err != nil || !reflect.DeepEqual(foreign, base) {
				t.Fatal("effect crossed division", foreign, err)
			}
		}
		before := enterworld.CurrentHP(c)
		result := rt.MonsterBasicAttack(testDivision, instance, enterworld.ObjectIDForCharacter(c), 2, clock.NowMs())
		if !result.Accepted {
			t.Fatal("attack refused", result)
		}
		damage := before - enterworld.CurrentHP(c)
		if withModifier {
			if _, ok := rt.effects.RequestVoluntaryStop(testDivision, c.Name, 99, 900); !ok {
				t.Fatal("stop")
			}
			rt.effects.DrainStopRequested()
			after, err := rt.PlayerBaseStats(testDivision, c)
			if err != nil || !reflect.DeepEqual(after, base) {
				t.Fatal("retirement left stale display", after, err)
			}
		}
		return damage
	}
	base, buffed := measure(false), measure(true)
	if base <= 0 || buffed >= base {
		t.Fatal("installed defense did not reduce actual HP damage", base, buffed)
	}
}
