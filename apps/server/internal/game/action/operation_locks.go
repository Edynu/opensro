package action

import "sync"

// divisionOperationLocks gives each division an independent item-operation
// lane. The short map lock owns lock discovery only; gameplay runs under the
// returned division lock.
type divisionOperationLocks struct {
	mu       sync.Mutex
	division map[string]*sync.Mutex
}

func (locks *divisionOperationLocks) lock(divisionID string) func() {
	locks.mu.Lock()
	if locks.division == nil {
		locks.division = make(map[string]*sync.Mutex)
	}
	divisionLock := locks.division[divisionID]
	if divisionLock == nil {
		divisionLock = &sync.Mutex{}
		locks.division[divisionID] = divisionLock
	}
	locks.mu.Unlock()

	divisionLock.Lock()
	return divisionLock.Unlock
}

// lockDivision admits ordinary work concurrently across divisions while
// keeping one division's ground, pending, world, and character transitions in
// order. The maintenance barrier lets the all-division TTL sweep stop those
// lanes briefly without acquiring an open-ended set of locks.
func (rt *Runtime) lockDivision(divisionID string) func() {
	rt.maintenance.RLock()
	unlockDivision := rt.operations.lock(divisionID)
	return func() {
		unlockDivision()
		rt.maintenance.RUnlock()
	}
}
