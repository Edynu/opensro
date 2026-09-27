/*
===========================================================================

effectstats_test.go - effect writes through the parameter graph

===========================================================================
*/

package combat

import (
	"math"
	"reflect"
	"testing"

	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/paramkeeper"
)

func TestEffectWritesUseCombatAndWireDependencyGraph(t *testing.T) {
	c := &domain.Character{Level: pointer(1), Strength: pointer(100), Intellect: pointer(100)}
	base, _, err := PlayerStats(c, Catalogs{Items: itemRefs{}})
	if err != nil {
		t.Fatal(err)
	}
	writes := []paramkeeper.Write{
		{Parameter: 1, Source: 0x10000, Value: 100},
		{Parameter: 5, Source: 0x10001, Value: 20},
		{Parameter: 5, Channel: paramkeeper.PercentSum, Source: 0x10002, Value: 50},
	}
	before := append([]paramkeeper.Write(nil), writes...)
	stats, _, err := PlayerStatsWithModifiers(c, Catalogs{Items: itemRefs{}}, writes, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Param 1 -> 5 contributes 19 at strength 100, 38 at strength 200.
	// Independent flat defense adds 20 before the 50-percent modifier.
	if stats.Strength != 200 || stats.PhysicalDefense != 87 || base.PhysicalDefense != 19 || stats.PhysicalAttackMin <= base.PhysicalAttackMin {
		t.Fatal("effect bypassed dependency graph", base, stats)
	}
	wire, err := PlayerBaseStatsWithModifiers(c, Catalogs{Items: itemRefs{}}, writes, nil)
	if err != nil || wire.PhysicalDefense != 87 || wire.PhysicalAttackMin != uint32(stats.PhysicalAttackMin) {
		t.Fatal("wire differs from combat", wire, err)
	}
	if !reflect.DeepEqual(before, writes) || *c.Strength != 100 {
		t.Fatal("projection mutated authority")
	}
	retired, _, err := PlayerStatsWithModifiers(c, Catalogs{Items: itemRefs{}}, nil, nil)
	if err != nil || !reflect.DeepEqual(retired, base) {
		t.Fatal("removed effects survived projection")
	}
}

func TestEffectWritesRejectForeignSourcesAndInvalidPrograms(t *testing.T) {
	ref := &enterworld.ItemRef{RefObjID: 1, Codename: "TEST_ARMOR", TypeIDs: [4]int64{3, 1, 1, 1}, Combat: &enterworld.ItemCombatRef{PhysicalDefense: enterworld.ItemStatRange{Min: 10, Max: 10}}}
	c := &domain.Character{Level: pointer(1), Strength: pointer(20), Intellect: pointer(20), MissionInventory: []domain.InventoryRow{{Slot: 0, RefObjID: 1, Codename: ref.Codename, VarianceBits: "0", Durability: 1}}}
	items := itemRefs{ref.Codename: ref}
	base, _, err := PlayerStats(c, Catalogs{Items: items})
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []paramkeeper.Write{
		{Parameter: 5, Source: 0, Value: 10},
		{Parameter: 12, Source: 1024, Value: 10},      // collision across parameters
		{Parameter: 5, Source: 0x40000005, Value: 10}, // graph-node source (0x40000000+ID)
		{Parameter: 511, Source: 0x10000, Value: 10},
		{Parameter: 5, Source: 0x10000, Value: float32(math.NaN())},
	} {
		stats, _, err := PlayerStatsWithModifiers(c, Catalogs{Items: items}, []paramkeeper.Write{{Parameter: 5, Source: 0x10001, Value: 100}, bad}, nil)
		if err == nil || stats.PhysicalDefense != 0 {
			t.Fatal("partial or aliased effect accepted", bad, stats, err)
		}
	}
	after, _, err := PlayerStats(c, Catalogs{Items: items})
	if err != nil || !reflect.DeepEqual(base, after) {
		t.Fatal("rejected projection changed later stats")
	}
}

func TestEffectDefenseCapIsFrozenBeforeLaterStatChanges(t *testing.T) {
	c := &domain.Character{Level: pointer(1), Strength: pointer(100), Intellect: pointer(100)}
	base, _, err := PlayerStats(c, Catalogs{Items: itemRefs{}})
	if err != nil {
		t.Fatal(err)
	}
	writes, err := defenseModifierWrites(0x10000, DefenseModifierInput{
		Physical: 1000, CapPercent: 10,
		CurrentPhysical: float32(base.PhysicalDefense), CurrentMagical: float32(base.MagicalDefense),
	})
	if err != nil {
		t.Fatal(err)
	}
	writes = append(writes, paramkeeper.Write{Parameter: 1, Source: 0x10001, Value: 100})
	stats, _, err := PlayerStatsWithModifiers(c, Catalogs{Items: itemRefs{}}, writes, nil)
	if err != nil || stats.PhysicalDefense != 39 {
		t.Fatal("installation cap must remain 1 after base defense rises from 19 to 38", stats, err)
	}
	wire, err := PlayerBaseStatsWithModifiers(c, Catalogs{Items: itemRefs{}}, writes, nil)
	if err != nil || wire.PhysicalDefense != 39 {
		t.Fatal("wire recalculated frozen contribution", wire, err)
	}
}
