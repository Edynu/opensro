package action

import (
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/instance"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

func TestPopulationAdmissionRequiresAllocatedLifetime(t *testing.T) {
	rt, c := newActiveEffectTestRuntime(t, staticSkillSource{})
	rt.Monsters = simulation.NewMonsterState(monster.TemplateFromParts(nil, nil))
	packed := uint32(instance.Pack(10, 1))
	c.World = &enterworld.CharacterWorld{PackedInstance: &packed}
	if err := rt.AdmitCharacterSession(testDivision, c.Name, 1); err == nil {
		t.Fatal("persisted ID manufactured an allocation")
	}
	lease, status := rt.Monsters.AllocatePopulation(testDivision, instance.ID(packed))
	if status != instance.Success {
		t.Fatal(status)
	}
	if err := rt.AdmitCharacterSession(testDivision, c.Name, 1); err != nil {
		t.Fatal(err)
	}
	if err := rt.AdmitCharacterSession(testDivision, c.Name, 2); err != nil {
		t.Fatal(err)
	}
	rt.ForgetCharacterSession(testDivision, c.Name, 1)
	if got, ok := rt.CharacterPopulationLease(testDivision, c.Name, 2); !ok || got != lease {
		t.Fatal("old socket retired replacement membership")
	}
	if !rt.Monsters.ReleasePopulation(testDivision, lease) {
		t.Fatal("release")
	}
	replacement, status := rt.Monsters.AllocatePopulation(testDivision, instance.ID(packed))
	if status != instance.Success || replacement == lease {
		t.Fatal("replacement")
	}
	if _, ok := rt.CharacterPopulationLease(testDivision, c.Name, 2); ok {
		t.Fatal("retired membership adopted replacement world")
	}
	if err := rt.AdmitCharacterSession(testDivision, c.Name, 3); err == nil {
		t.Fatal("stale actor readmitted across layer lifetime")
	}
	rt.ForgetCharacterSession(testDivision, c.Name, 2)
	if err := rt.AdmitCharacterSession(testDivision, c.Name, 3); err != nil {
		t.Fatal(err)
	}
}
