package action

import (
	"testing"
	"time"
)

func TestDivisionOperationLocksIsolateUnrelatedWorlds(t *testing.T) {
	rt := &Runtime{}
	unlockFirst := rt.lockDivision("division-a")

	otherEntered := make(chan struct{})
	otherRelease := make(chan struct{})
	go func() {
		unlock := rt.lockDivision("division-b")
		close(otherEntered)
		<-otherRelease
		unlock()
	}()
	select {
	case <-otherEntered:
	case <-time.After(time.Second):
		t.Fatal("an unrelated division blocked behind active item work")
	}

	sameEntered := make(chan struct{})
	go func() {
		unlock := rt.lockDivision("division-a")
		close(sameEntered)
		unlock()
	}()
	select {
	case <-sameEntered:
		t.Fatal("two item operations entered the same division concurrently")
	case <-time.After(25 * time.Millisecond):
	}
	close(otherRelease)
	unlockFirst()
	select {
	case <-sameEntered:
	case <-time.After(time.Second):
		t.Fatal("same-division work did not enter after its predecessor returned")
	}
}
