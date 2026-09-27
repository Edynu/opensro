package movement

import (
	"sync"

	"opensro.online/server/internal/game/world/simulation"
)

const characterOperationStripeCount = 256

// characterOperationLocks preserves command order for one character without
// serializing every mover in the process. Fixed stripes avoid retaining one
// lock forever for every character name that has ever connected.
type characterOperationLocks struct {
	stripes [characterOperationStripeCount]sync.Mutex
}

func characterOperationStripe(key string) uint8 {
	const (
		offset = uint32(2166136261)
		prime  = uint32(16777619)
	)
	hash := offset
	for index := 0; index < len(key); index++ {
		hash ^= uint32(key[index])
		hash *= prime
	}
	return uint8(hash % characterOperationStripeCount)
}

func (locks *characterOperationLocks) lock(key string) func() {
	stripe := &locks.stripes[characterOperationStripe(key)]
	stripe.Lock()
	return stripe.Unlock
}

func (rt *Runtime) lockCharacter(divisionID, characterName string) func() {
	return rt.operations.lock(simulation.WorldKey(divisionID, characterName))
}
