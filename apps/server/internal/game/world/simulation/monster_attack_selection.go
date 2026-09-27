package simulation

import (
	"math"
	"opensro.online/server/internal/game/world/monster"
)

func (ops *MonsterMoverOps) adoptMonsterAttack(mover *monster.MoverState, plan MonsterAttackPlan) {
	if mover.AttackSkillID == 0 || mover.AttackSkillID != plan.SkillID {
		sample := ops.rand()
		if math.IsNaN(sample) || sample < 0 {
			sample = 0
		}
		if sample >= 1 {
			sample = math.Nextafter(1, 0)
		}
		mover.AttackIntervalMs = monster.NextAttackInterval(mover.AttackIntervalMs, uint32(plan.CooldownMs), uint32(sample*32768))
	}
	mover.AttackSummon = plan.Summon
	mover.AttackSelfEffect = plan.SelfEffect
	mover.AttackSkillID = plan.SkillID
	mover.AttackReach = float64(plan.Reach)
	mover.AttackCooldownMs = plan.CooldownMs
}
