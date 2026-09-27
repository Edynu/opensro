package action

import (
	"fmt"

	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

// lifePublicationPhase is the protocol statechart owned by the action lane.
// HP mutation happens before this publisher is created; each method advances
// exactly one legal publication edge and returns the frame for that edge.
type lifePublicationPhase uint8

const (
	lifePhaseFatalHitCommitted lifePublicationPhase = iota + 1
	lifePhaseDeathBaselinePublished
	lifePhaseDead
	lifePhaseRebirthVitalsPending
	lifePhaseRebirthVitalsPublished
	lifePhaseRestored
)

type lifePublicationTransaction struct {
	gid   uint32
	phase lifePublicationPhase
}

type lifePublicationPayload struct {
	opcode  uint16
	payload []byte
}

func beginFatalLifePublication(gid uint32) *lifePublicationTransaction {
	if gid == 0 {
		panic("life publication requires a non-zero object gid")
	}
	return &lifePublicationTransaction{gid: gid, phase: lifePhaseFatalHitCommitted}
}

func beginRebirthLifePublication(gid uint32) *lifePublicationTransaction {
	if gid == 0 {
		panic("life publication requires a non-zero object gid")
	}
	return &lifePublicationTransaction{gid: gid, phase: lifePhaseRebirthVitalsPending}
}

func (tx *lifePublicationTransaction) publishDeathBaseline() lifePublicationPayload {
	tx.require(lifePhaseFatalHitCommitted, "death baseline")
	tx.phase = lifePhaseDeathBaselinePublished
	return lifePublicationPayload{
		opcode: simulation.OpVitalsUpdate,
		payload: simulation.HPRefreshPayload(
			tx.gid,
			simulation.VitalsSourceCombatDamage,
			0,
		),
	}
}

func (tx *lifePublicationTransaction) publishDead() lifePublicationPayload {
	tx.require(lifePhaseDeathBaselinePublished, "dead LIFE state")
	tx.phase = lifePhaseDead
	return lifePublicationPayload{
		opcode: wire.OpObjectStateRefresh,
		payload: wire.ObjectStateRefresh{
			Gid: tx.gid, StateType: wire.StateChannelLife, Value: wire.LifeStateDead,
		}.Encode(),
	}
}

func (tx *lifePublicationTransaction) publishRebirthVitals() {
	tx.require(lifePhaseRebirthVitalsPending, "rebirth vitals")
	tx.phase = lifePhaseRebirthVitalsPublished
}

func (tx *lifePublicationTransaction) publishLifeRestored() lifePublicationPayload {
	tx.require(lifePhaseRebirthVitalsPublished, "restored LIFE state")
	tx.phase = lifePhaseRestored
	return lifePublicationPayload{
		opcode: wire.OpObjectStateRefresh,
		payload: wire.ObjectStateRefresh{
			Gid: tx.gid, StateType: wire.StateChannelLife, Value: wire.LifeStateAlive,
		}.Encode(),
	}
}

func (tx *lifePublicationTransaction) require(want lifePublicationPhase, operation string) {
	if tx == nil || tx.phase != want {
		got := lifePublicationPhase(0)
		if tx != nil {
			got = tx.phase
		}
		panic(fmt.Sprintf("life publication %s is illegal in phase %d (want %d)", operation, got, want))
	}
}
