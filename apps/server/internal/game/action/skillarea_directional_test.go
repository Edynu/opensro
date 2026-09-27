/*
===========================================================================

skillarea_directional_test.go - tests for skillarea_directional.go

===========================================================================
*/

package action

import (
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

// 58AF60 against hand-computed geometry: a reach of 100 along +X and a
// width of 10.
func TestInDirectionalShape(t *testing.T) {
	dir := vec3{100, 0, 0}
	for _, tc := range []struct {
		name              string
		rel               vec3
		caster, candidate int32
		want              bool
	}{
		{"on the line", vec3{50, 0, 0}, 0, 0, true},
		{"inside the width", vec3{50, 0, 9}, 0, 0, true},
		{"on the width is outside", vec3{50, 0, 10}, 0, 0, false},
		{"at the reach", vec3{100, 0, 0}, 0, 0, true},
		{"past the reach", vec3{101, 0, 0}, 0, 0, false},
		{"radii extend the reach", vec3{110, 0, 0}, 4, 6, true},
		{"radius widens the line", vec3{50, 0, 15}, 0, 6, true},
		{"height is ignored", vec3{50, 1000, 0}, 0, 0, true},
		{"behind the caster still counts", vec3{-50, 0, 5}, 0, 0, true},
		{"on the caster", vec3{0, 0, 0}, 0, 0, true},
	} {
		if got := inDirectionalShape(tc.rel, dir, tc.caster, tc.candidate, 10); got != tc.want {
			t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Shape 3 through areaVictims: the primary first, then the monsters within
// the width of the caster-to-primary line, up to MaxTargets; a monster off
// the line is left out.
func TestAreaShapeThreeSelectsAlongTheLine(t *testing.T) {
	rt, clock, c, primary := newCombatTestRuntime(t, 100000)
	origin := simulation.SeedWorldState(c).Spawn
	origin.X = primary.Spawn.X - 50
	origin.Y, origin.Z = primary.Spawn.Y, primary.Spawn.Z
	rt.Worlds.Update(simulation.WorldKey(testDivision, c.Name), func() simulation.WorldState { return simulation.SeedWorldState(c) }, func(w *simulation.WorldState) { w.Spawn = origin })

	var nests []monster.NestRow
	for _, offset := range [][2]float64{{0, 0}, {20, 0}, {-20, 60}, {40, 0}} {
		spawn := primary.Spawn
		spawn.X += offset[0]
		spawn.Z += offset[1]
		nests = append(nests, monster.NestRow{SpawnPoint: spawn, RetailEvidence: true, MaxCount: 1})
	}
	rt.Monsters = simulation.NewMonsterState(monster.TemplateFromParts(map[uint32]monster.MonsterRef{primary.Ref.RefObjID: primary.Ref}, nests))
	rt.Monsters.SetTimeSource(clock.Now)
	rt.Monsters.StartDivision(testDivision)
	rt.Monsters.AdvancePopulation(rt.Monsters.CurrentTimeMillis())
	targets := rt.Monsters.InstancesInRegions(testDivision, []uint16{primary.Spawn.RegionID})

	area := enterworld.SkillOffensiveArea{Shape: 3, Radius: 10, MaxTargets: 5}
	got := rt.areaVictims(testDivision, c, targets[0], area, 150, clock.Now().UnixMilli())
	if len(got) != 3 || got[0].Gid != targets[0].Gid || got[1].Gid != targets[1].Gid || got[2].Gid != targets[3].Gid {
		t.Fatalf("shape 3 picked %+v", got)
	}
	area.MaxTargets = 2
	if got := rt.areaVictims(testDivision, c, targets[0], area, 150, clock.Now().UnixMilli()); len(got) != 2 {
		t.Fatalf("MaxTargets 2 picked %d", len(got))
	}
}
