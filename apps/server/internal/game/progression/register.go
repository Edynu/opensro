package progression

import (
	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/transport"
)

// Register wires the stat-plane handlers onto the hub: 0x727A/0x7552 stat
// allocation, 0x7165 mastery training and 0x72CB skill learning. deps
// MUST be the same instance
// enterworld.Register ran with - both lanes resolve characters through it,
// and separate instances would hold separate *Character pointers whose
// mutations diverge.
func Register(hub *transport.Hub, deps Dependencies) *Runtime {
	rt := NewRuntime(deps)
	rt.Register(hub)
	return rt
}

// Register wires this runtime's handlers onto the hub.
func (rt *Runtime) Register(hub *transport.Hub) {
	hub.Handle(wire.OpAllocStrRequest, rt.hubHandler(hub, rt.HandleAllocStr))
	hub.Handle(wire.OpAllocIntRequest, rt.hubHandler(hub, rt.HandleAllocInt))
	hub.Handle(wire.OpMasteryLevelUpRequest, rt.hubHandler(hub, rt.HandleMasteryLevelUp))
	hub.Handle(wire.OpSkillLearnRequest, rt.hubHandler(hub, rt.HandleSkillLearn))
	// The dev exp-grant trigger (0xDE01, NOT a retail opcode - see the
	// OpDevGrantExp doc) only exists on the hub when explicitly enabled;
	// when disabled the opcode is simply unregistered and the hub drops
	// the frame like any other unknown opcode.
	if DevExpGrantEnabled() {
		hub.Handle(OpDevGrantExp, rt.hubHandler(hub, rt.HandleDevGrantExp))
		log.Warnf("progression: GM-only DEV exp-grant trigger ENABLED (opcode 0x%04X, %s=1); leave disabled outside diagnostics", OpDevGrantExp, EnvDevExpGrant)
	}
}

// opFunc is one transport-free runtime operation.
type opFunc func(divisionID string, character *enterworld.Character, payload []byte) OpResult

// hubHandler adapts a runtime operation onto the hub: resolve the bound
// character (never trust client-supplied identity on later frames), run the
// op, answer the acting session, then fan its public presentation projection
// to division peers. Ordinary stat/mastery operations have no broadcast;
// the guarded experience trigger can carry the same gid-only level-up effect
// as production combat and quest rewards.
//
// An UNBOUND session is discarded silently. The retail client cannot
// compose these frames before enter-world (the buttons live in windows the
// mission scene owns), and the acks are typed per-request - answering a
// refusal to a session with no character would invent a conversation the
// native client never has.
func (rt *Runtime) hubHandler(hub *transport.Hub, op opFunc) transport.HandlerFunc {
	return func(s *transport.Session, opcode uint16, payload []byte) {
		character, divisionID, bound := enterworld.SessionCharacter(rt.deps, s)
		if !bound {
			log.Debugf("progression: 0x%04X from unbound session %d discarded", opcode, s.ID)
			return
		}
		result := op(divisionID, character, payload)
		sendFrames(s, result.Frames)
		if len(result.Broadcast) == 0 {
			return
		}
		accept := func(peer *transport.Session) bool {
			if peer.ID == s.ID {
				return false
			}
			peerDivision, ok := peer.DivisionID()
			return ok && peerDivision == divisionID
		}
		for _, frame := range result.Broadcast {
			hub.BroadcastFunc(accept, frame.Opcode, frame.Payload)
		}
	}
}

func sendFrames(s *transport.Session, frames []wire.Frame) {
	for _, frame := range frames {
		if err := s.Send(frame.Opcode, frame.Payload); err != nil {
			log.Debugf("progression: send 0x%04X to session %d failed: %v", frame.Opcode, s.ID, err)
			return
		}
	}
}
