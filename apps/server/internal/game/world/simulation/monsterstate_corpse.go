/*
===========================================================================

monsterstate_corpse.go - monster death and the corpse pose

===========================================================================
*/

package simulation

import "opensro.online/server/internal/game/world/monster"

/*
==================
settleCorpseLocked

settleCorpseLocked is part of the positive-HP -> zero-HP transaction.
Removal/respawn remains an explicit later lifecycle operation. Until then,
combat, interest and bootstrap must all see the same frozen death pose.
A retained NavigationPath supplies the authoritative surface even with a
nil fallback resolver; it is sampled before discarding movement ownership.
==================
*/
func (state *divisionMonsterState) settleCorpseLocked(instance *monster.Instance, nowMs int64) {
	gid := instance.Gid
	if mover, ok := state.movers.lookup(gid); ok {
		mover.Pose = mover.LivePoseAt(nowMs, nil)
		mover.From, mover.To = monster.Pose{}, monster.Pose{}
		mover.DepartMs, mover.ArriveMs = 0, 0
		mover.CancelNavigation()
		mover.AdoptNavigation(nil)
		state.movers.set(gid, mover)
	}
	state.releaseApproachActor(gid)
	// Death retires every slot (4A59F0) without running start/tick effects;
	// the corpse keeps no parameter writes, motion hold or tactics events.
	instance.Abnormal = nil
	instance.Motion = monster.MotionHold{}
	delete(state.abnormalActive, gid)
	delete(state.aiEvents, gid)
}
