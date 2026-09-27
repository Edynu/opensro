package action

import (
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

// RunMonsterAction extends the division transaction through non-blocking packet
// enqueue. Returning a committed result before enqueue allowed a later killing
// hit to publish the caster's death first. The scoped attack must not escape run.
func (rt *Runtime) RunMonsterAction(division string, run func(simulation.MonsterAttackOperation)) {
	unlock := rt.lockDivision(division)
	defer unlock()
	run(func(d string, instance monster.Instance, target, skill uint32, now int64) simulation.MonsterAttackResult {
		if d != division {
			panic("monster attack crossed its division transaction")
		}
		return rt.monsterAttackStage(d, instance, target, skill, now, nil)
	})
}
