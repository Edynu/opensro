package action

import (
	"math"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

// 58482E..584A67 checks the live pair, not the two original cast positions.
// Retirement itself stays in the existing character-effect update owner.
func (rt *Runtime) advanceLinkedEffects(nowMs int64) {
	for _, link := range rt.effects.Links() {
		unlock := rt.lockDivision(link.DivisionID)
		source := rt.characterSnapshot(link.DivisionID, rt.findCharacter(link.DivisionID, link.SourceName))
		target := rt.characterSnapshot(link.DivisionID, rt.findCharacter(link.DivisionID, link.TargetName))
		valid := source != nil && target != nil && !source.DeletePending && !target.DeletePending &&
			enterworld.ObjectIDForCharacter(source) == link.SourceGID && enterworld.ObjectIDForCharacter(target) == link.TargetGID &&
			enterworld.CharacterAlive(source) && enterworld.CharacterAlive(target)
		if valid && link.MaxDistance != 0 {
			from := rt.liveSpawn(simulation.WorldKey(link.DivisionID, source.Name), source, nowMs)
			to := rt.liveSpawn(simulation.WorldKey(link.DivisionID, target.Name), target, nowMs)
			d := simulation.WorldDistance2D(from, to)
			y := to.Y - from.Y
			valid = math.Sqrt(d*d+y*y) <= float64(link.MaxDistance)
		}
		if !valid {
			rt.effects.StopLink(link.DivisionID, link.SourceToken)
		}
		unlock()
	}
}
