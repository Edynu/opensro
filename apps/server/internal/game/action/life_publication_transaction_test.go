package action

import (
	"testing"

	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

func TestLifePublicationTransactionEnforcesFatalAndRebirthOrder(t *testing.T) {
	fatal := beginFatalLifePublication(0x10203040)
	baseline := fatal.publishDeathBaseline()
	if baseline.opcode != simulation.OpVitalsUpdate {
		t.Fatalf("baseline opcode = %#x", baseline.opcode)
	}
	dead := fatal.publishDead()
	if dead.opcode != wire.OpObjectStateRefresh {
		t.Fatalf("dead opcode = %#x", dead.opcode)
	}

	rebirth := beginRebirthLifePublication(0x10203040)
	rebirth.publishRebirthVitals()
	alive := rebirth.publishLifeRestored()
	decoded, err := wire.DecodeObjectStateRefresh(alive.payload)
	if err != nil || decoded.Value != wire.LifeStateAlive {
		t.Fatalf("alive frame = %+v / %v", decoded, err)
	}
}

func TestLifePublicationTransactionRejectsSkippedAndRepeatedEdges(t *testing.T) {
	assertPanics := func(name string, fn func()) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Fatalf("%s did not panic", name)
			}
		}()
		fn()
	}

	assertPanics("death without baseline", func() {
		beginFatalLifePublication(7).publishDead()
	})
	assertPanics("life without vitals", func() {
		beginRebirthLifePublication(7).publishLifeRestored()
	})
	assertPanics("repeated release", func() {
		tx := beginRebirthLifePublication(7)
		tx.publishRebirthVitals()
		tx.publishLifeRestored()
		tx.publishLifeRestored()
	})
}
