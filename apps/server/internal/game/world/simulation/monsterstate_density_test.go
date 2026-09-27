package simulation

import (
	"math"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/world/monster"
	"testing"
)

func TestPopulationCellNativeFloatBoundaries(t *testing.T) {
	for _, tc := range []struct {
		x     float64
		cell  int
		valid bool
	}{
		{0, 0, true}, {319.9999, 0, true}, {320, 1, true},
		{1919.9998, 5, true}, {math.Nextafter(1920, 0), 0, false},
		{1920, 0, false}, {-1, 0, false}, {math.NaN(), 0, false}, {math.Inf(1), 0, false},
	} {
		cell, ok := populationCell(Spawn{RegionID: lifecycleRegion, X: tc.x, Z: 0})
		if ok != tc.valid || ok && cell.x != tc.cell {
			t.Fatalf("x=%g: cell=%+v valid=%v", tc.x, cell, ok)
		}
	}
}

func TestDensityCountsPerNestCellsAndRerollsIntervals(t *testing.T) {
	a, b := lifecycleNest(100), lifecycleNest(200)
	a.HiveKey, b.HiveKey = "same", "same"
	a.HiveDensity = monster.HiveDensityPolicy{Kind: 1, MonstersPerPC: 2, Step: 30, Maximum: 80}
	b.HiveDensity = a.HiveDensity
	w := newLifecycleWorld(t, lifecycleRef(0), a, b)
	w.s.StartDivision("division")
	queries := 0
	w.s.SetPopulationPlayers(func(string, int64) []PopulationPlayer {
		queries++
		return []PopulationPlayer{
			{GID: 1, World: domain.DefaultWorldInstance, Spawn: Spawn{RegionID: lifecycleRegion, X: 319, Z: 100}},
			{GID: 1, World: domain.DefaultWorldInstance, Spawn: Spawn{RegionID: lifecycleRegion, X: 319, Z: 100}},
			{GID: 2, World: domain.DefaultWorldInstance, Spawn: Spawn{RegionID: lifecycleRegion, X: 320, Z: 100}},
			{GID: 3, World: 0x20001, Spawn: Spawn{RegionID: lifecycleRegion, X: 100, Z: 100}},
		}
	})
	w.at(59999)
	if queries != 1 || w.nest(0).ratePct != 0 {
		t.Fatal("history advanced before second sample")
	}
	last := w.nest(0).lastMs
	w.s.AdvancePopulation(lifecycleBase.UnixMilli() + 60000)
	w.at(60000)
	// One PC counted twice, once for each nest sharing the same message
	// cell. Second sample writes mean 2 into one slot; (2+0)/2 = 1.
	if queries != 2 || w.nest(0).ratePct != 30 || w.nest(1).intervalMs != 7000 || w.nest(0).lastMs != last {
		t.Fatalf("density/interval/restart: queries=%d nest=%+v", queries, w.nest(0))
	}
	w.at(120000)
	if w.nest(0).ratePct != 60 || w.nest(0).intervalMs != 4000 {
		t.Fatalf("history did not reach steady density: %+v", w.nest(0))
	}
}
