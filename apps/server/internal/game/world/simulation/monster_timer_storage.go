package simulation

import "opensro.online/server/internal/game/world/monster"

// All accesses hold MonsterState.mu. A read that needs a mutable timer bank
// restores it exactly once; subsequent consumers retain the existing pointer.
func (state *divisionMonsterState) aiTimer(gid uint32) *monster.AITimeManager {
	if p := state.aiTimers[gid]; p != nil {
		return p
	}
	if stored, ok := state.storedAITimers[gid]; ok {
		m := stored.Restore()
		state.aiTimers[gid] = &m
		delete(state.storedAITimers, gid)
		return &m
	}
	return nil
}

func (state *divisionMonsterState) storeAITimer(gid uint32) {
	if p := state.aiTimers[gid]; p != nil {
		if state.storedAITimers == nil {
			state.storedAITimers = make(map[uint32]monster.StoredAITimers)
		}
		state.storedAITimers[gid] = p.Store()
		delete(state.aiTimers, gid)
	}
}
