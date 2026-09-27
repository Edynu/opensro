package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"testing"
)

func TestDormantTimerRestoresWithoutReset(t *testing.T) {
	p := monster.NewAITimeManager()
	p.SetTimer(1, 1234, 7, 0, true, func() uint32 { return 17 })
	p.CheckTimer(1, 0xfffffffe)
	want := *p
	state := divisionMonsterState{aiTimers: map[uint32]*monster.AITimeManager{77: p}}
	state.storeAITimer(77)
	if state.aiTimers[77] != nil || len(state.storedAITimers) != 1 {
		t.Fatal("mutable bank retained")
	}
	got := state.aiTimer(77)
	if got == nil || *got != want || len(state.storedAITimers) != 0 {
		t.Fatal("restoration lost timer state")
	}
	if state.aiTimer(77) != got {
		t.Fatal("mutable pointer identity changed")
	}
	state.storeAITimer(77)
	state.forgetDormant(77)
	if state.aiTimers[77] == nil || *state.aiTimers[77] != want {
		t.Fatal("wake did not restore timers")
	}
	if state.aiTimer(999) != nil {
		t.Fatal("lookup fabricated timers")
	}
}
