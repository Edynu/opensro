package action

import (
	"encoding/binary"
	"math"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

// CGObjChar_RefreshMovementSpeeds (0x4AA410) refreshes the effective movement
// pair from active parameters and publishes 0x30D0 (0x376F on the v1.150
// client). The registry owns installed sources separately from pending-stop
// rows: a stop alone does not uninstall; replacement handoff or drain does.
func (rt *Runtime) refreshMovementEffects(division string, c *enterworld.Character, now int64) []wire.Frame {
	if rt.Worlds == nil {
		return nil
	}
	factor := float32(1)
	for _, effect := range rt.effects.Snapshot(division, c.Name) {
		if effect.MovementPercent != 0 {
			factor = float32(float64(factor) * (1 + float64(float32(effect.MovementPercent))/100))
		}
	}
	for _, effect := range rt.effects.Snapshot(division, c.Name) {
		if effect.HidePenaltyPercent == 0 && effect.HideBonusPercent == 0 {
			continue
		}
		// PercentProduct reduces in source-key order: STSP's key 6 first.
		factor = float32(float64(factor) * (1 + float64(effect.HideBonusPercent)/100))
		factor = float32(float64(factor) * (1 - float64(effect.HidePenaltyPercent)/100))
	}
	// SPDU is the built-in mode-3 percentage channel, separate from haste.
	if c.NativeBodyStatus == 1 {
		factor *= 2
	}
	walk, run := float32(simulation.WalkSpeed)*factor, float32(simulation.RunSpeed)*factor
	if tw, tr, ok := rt.transformSpeeds(c); ok {
		walk, run = tw, tr
	}
	changed := false
	rt.Worlds.Update(simulation.WorldKey(division, c.Name), func() simulation.WorldState { return simulation.SeedWorldState(c) }, func(world *simulation.WorldState) { changed = world.UpdateMovementSpeeds(walk, run, now) })
	if !changed {
		return nil
	}
	payload := make([]byte, 12)
	binary.LittleEndian.PutUint32(payload, enterworld.ObjectIDForCharacter(c))
	binary.LittleEndian.PutUint32(payload[4:], math.Float32bits(walk))
	binary.LittleEndian.PutUint32(payload[8:], math.Float32bits(run))
	return []wire.Frame{{Opcode: 0x376F, Payload: payload}}
}
