/*
===========================================================================

development_passive.go - combat readout for the passive-critical fixture

The agent API owns the fixture's admission and seeding; the figures it
reports come from the combat rules, which only this wiring may reach.

===========================================================================
*/

package main

import (
	agentapi "opensro.online/server/internal/agent/api"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
)

// passiveCriticalReader is nil, leaving the fixture off, without both
// catalogs.
func (game *gameplayPlane) passiveCriticalReader() agentapi.PassiveCriticalReader {
	if game.deps.Items == nil || game.deps.Skills == nil {
		return nil
	}
	return game.passiveCriticalReport
}

/*
==================
passiveCriticalReport

The character's stats with and without its learned skills, so the fixture
can show what the passives add over the equipment alone.
==================
*/
func (game *gameplayPlane) passiveCriticalReport(snapshot *domain.Character) (map[string]any, error) {
	catalogs := combat.Catalogs{Items: game.deps.Items, Skills: game.deps.Skills}
	stats, loadout, err := combat.PlayerStats(snapshot, catalogs)
	if err != nil {
		return nil, err
	}
	bare := snapshot.Snapshot()
	bare.Skills = nil
	base, _, err := combat.PlayerStats(bare, catalogs)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"criticalRate":          stats.CriticalRate,
		"equipmentCriticalRate": base.CriticalRate,
		"passiveBonus":          stats.CriticalRate - base.CriticalRate,
		"weaponKind":            loadout.WeaponKind,
		"twoHandPowerPercent":   stats.SkillParameters[enterworld.ParameterTwoHandPower],
		"physicalAttackMin":     stats.PhysicalAttackMin,
		"physicalAttackMax":     stats.PhysicalAttackMax,
		"equipmentAttackMin":    base.PhysicalAttackMin,
		"equipmentAttackMax":    base.PhysicalAttackMax,
	}, nil
}
