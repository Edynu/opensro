package movement

import (
	"fmt"
	"testing"
	"time"

	"opensro.online/server/internal/game/world/simulation"
)

func TestCharacterOperationLocksDoNotSerializeEveryMover(t *testing.T) {
	rt := &Runtime{}
	const division = "division-a"
	const firstName = "first"
	firstKey := simulation.WorldKey(division, firstName)

	secondName := ""
	for index := 0; index < 1000; index++ {
		candidate := fmt.Sprintf("peer-%d", index)
		if characterOperationStripe(simulation.WorldKey(division, candidate)) != characterOperationStripe(firstKey) {
			secondName = candidate
			break
		}
	}
	if secondName == "" {
		t.Fatal("could not find a distinct operation stripe")
	}

	unlockFirst := rt.lockCharacter(division, firstName)
	secondEntered := make(chan struct{})
	go func() {
		unlock := rt.lockCharacter(division, secondName)
		close(secondEntered)
		unlock()
	}()
	select {
	case <-secondEntered:
	case <-time.After(time.Second):
		t.Fatal("an unrelated character blocked behind an active mover")
	}
	unlockFirst()
}

func TestCharacterOperationLocksPreserveOneMoversOrder(t *testing.T) {
	rt := &Runtime{}
	unlockFirst := rt.lockCharacter("division-a", "same")

	secondEntered := make(chan struct{})
	go func() {
		unlock := rt.lockCharacter("division-a", "same")
		close(secondEntered)
		unlock()
	}()
	select {
	case <-secondEntered:
		t.Fatal("two commands entered the same character concurrently")
	case <-time.After(25 * time.Millisecond):
	}
	unlockFirst()
	select {
	case <-secondEntered:
	case <-time.After(time.Second):
		t.Fatal("queued character command did not enter after its predecessor")
	}
}
