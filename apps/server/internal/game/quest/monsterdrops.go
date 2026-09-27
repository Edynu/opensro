package quest

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/inventory"
)

type MonsterDropRule struct {
	MonsterCodenames []string
	AnyMonster       bool
	ChancePercent    float32
	// Optional rates aligned with MonsterCodenames; exclusive with the shared
	// rate. Lua stores each species' probability as float32 (86c077..86c081).
	SpeciesChancePercent []float32
	MinPlayerLevel       uint8
	MaxHeld              uint32
}

func validateMonsterDrop(spec QuestSpec) error {
	rule := spec.MonsterDrop
	if rule == nil {
		return nil
	}
	validChance := func(p float32) bool { return p > 0 && p <= 100 && !math.IsNaN(float64(p)) }
	if spec.Objective != ObjectiveCollect ||
		rule.AnyMonster == (len(rule.MonsterCodenames) != 0) ||
		(rule.MaxHeld != 0 && rule.MaxHeld < spec.CollectCount) {
		return fmt.Errorf("quest definitions: %s has an invalid monster-drop contract", spec.Codename)
	}
	if len(rule.SpeciesChancePercent) == 0 {
		if !validChance(rule.ChancePercent) {
			return fmt.Errorf("quest %s invalid drop probability", spec.Codename)
		}
	} else {
		if rule.AnyMonster || rule.ChancePercent != 0 || len(rule.SpeciesChancePercent) != len(rule.MonsterCodenames) {
			return fmt.Errorf("quest %s invalid species rates", spec.Codename)
		}
		for _, p := range rule.SpeciesChancePercent {
			if !validChance(p) {
				return fmt.Errorf("quest %s invalid species probability", spec.Codename)
			}
		}
	}
	seen := make(map[string]bool)
	for _, code := range rule.MonsterCodenames {
		if !strings.HasPrefix(code, "MOB_") || seen[code] {
			return fmt.Errorf("quest definitions: %s has an invalid or duplicate monster target %q", spec.Codename, code)
		}
		seen[code] = true
	}
	return nil
}

// MonsterDrops plans personal ground loot, not inventory grants. The accepted
// fatal-hit owner commits it with the ordinary loot, and pickup alone advances
// inventory-derived collection objectives. No quest state changes during RNG.
func (rt *Runtime) MonsterDrops(c *enterworld.Character, monster string, roll func() (uint32, error)) []inventory.ItemAmount {
	if c == nil || c.DeletePending || roll == nil {
		return nil
	}
	var out []inventory.ItemAmount
	for _, record := range c.ActiveQuests {
		def, ok := rt.Defs.ByRefID(record.RefID)
		if ok {
			def, ok = definitionAtStage(def, record.Stage)
		}
		if !ok || def.TimeLimitMinutes > 0 && record.RemainingMinutes == 0 {
			continue
		}
		for i := 0; i < missionCount(def); i++ {
			m := missionDefinition(def, i)
			out = append(out, missionMonsterDrops(c, m, monster, roll)...)
		}
	}
	return out
}

func missionMonsterDrops(c *enterworld.Character, def *Definition, monster string, roll func() (uint32, error)) []inventory.ItemAmount {
	if def.Objective != ObjectiveCollect || def.MonsterDrop == nil {
		return nil
	}
	rule := def.MonsterDrop
	if !rule.AnyMonster && !slices.Contains(rule.MonsterCodenames, monster) {
		return nil
	}
	if c.Level == nil || *c.Level < int64(rule.MinPlayerLevel) {
		return nil
	}
	var held uint64
	for _, item := range c.MissionInventory {
		if item.RefObjID == def.CollectItemRefID && item.Slot >= int64(inventory.EquipmentSlotEnd) && item.Slot < int64(inventory.BagSlotEnd) {
			held += uint64(max(1, item.StackCount))
		}
	}
	cap := rule.MaxHeld
	if cap == 0 {
		cap = def.CollectCount
	}
	if held >= uint64(cap) {
		return nil
	}
	chance := rule.ChancePercent
	if len(rule.SpeciesChancePercent) > 0 {
		chance = rule.SpeciesChancePercent[slices.Index(rule.MonsterCodenames, monster)]
	}
	first, err := roll()
	if err != nil {
		return nil
	}
	second, err := roll()
	if err != nil || !nativeQuestDropChance(chance, first, second) {
		return nil
	}
	return []inventory.ItemAmount{{Codename: def.CollectItemCodename, Count: 1}}
}

// SR_GameServer 57be70, IGameServer vtable afa76c slot 40. Two CRT
// 15-bit outputs form a 30-bit value, then modulo one million. The sample
// is rounded to float32 BEFORE comparison; zero is rejected and equality
// succeeds. Preserve these edges for both integral and fractional rates.
// The port supplies entropy, not the original process-wide CRT RNG stream.
func nativeQuestDropChance(chance float32, first, second uint32) bool {
	value := ((second&0x7fff)<<15 | (first & 0x7fff)) % 1000000
	sample := float32(float64(value) / 1000000)
	return sample >= float32(0.000001) && float64(chance) >= float64(sample)*100
}
