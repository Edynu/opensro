package chat

import (
	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/restriction"
	"opensro.online/server/internal/transport"
)

// Register wires the chat lane's 0x7367 handler onto the hub. Called
// from wiring.go with the SAME deps pointer every other lane retains.
// 0x7367 registers exactly once and no other lane touches
// 0x7367/0xB367/0x3667 (survey date 2026-07-29; the war-horn lane owns
// the v1.188 dump's colliding 0x7025).
type DeliveryPresence interface {
	PresenceView
	SessionByName(divisionID, name string) (*transport.Session, bool)
}

func Register(hub *transport.Hub, deps Dependencies, presence DeliveryPresence, parties PartyView) {
	hub.Handle(OpChatRequest, chatHubHandler(hub, deps, presence, parties))
}

// AllChatAccept is THE All/GM-chat cohort predicate: every bound session
// of the sender's division except the sender. Deliberately the same
// cohort as peer visibility (internal/game/world/simulation/peervis.go's same-division
// walk, the movement fan-out template) - everyone who can see you hears
// you, and every recipient holds the sender's gid spawned so the
// client-side registry lookup resolves a real name instead of L"??".
// When peer visibility gains region scoping, change THIS function with
// it - the two cohorts must move together (see HandleChat's scope note).
func AllChatAccept(origin *transport.Session, divisionID string) func(*transport.Session) bool {
	return func(peer *transport.Session) bool {
		if peer.ID == origin.ID {
			return false
		}
		peerDivision, ok := peer.DivisionID()
		return ok && peerDivision == divisionID
	}
}

// chatHubHandler adapts HandleChat onto the hub: resolve the bound
// character through the session identity keys (never a client-supplied
// name), route, answer the sender with the 0xB367 ack, fan the All/GM
// broadcast to the division cohort, and resolve each targeted delivery
// through the presence facade (a target who went offline between the
// handler and the send drops silently - the same posture as the letter
// push). A nil Ack stays silent on the wire (decode refusals only).
func chatHubHandler(hub *transport.Hub, deps Dependencies, presence DeliveryPresence, parties PartyView) transport.HandlerFunc {
	return func(s *transport.Session, opcode uint16, payload []byte) {
		character, divisionID, bound := enterworld.SessionCharacter(deps, s)
		if !bound {
			log.Debugf("chat: 0x%04X from unbound session %d discarded", opcode, s.ID)
			return
		}
		// Native admission precedes decoding and all publication/mutation.
		if restriction.Report(s, transport.CommandRestrictionChat) {
			return
		}
		outcome := HandleChat(deps, presence, parties, divisionID, character, payload)
		if outcome.Ack != nil {
			_ = s.Send(OpChatAck, outcome.Ack)
		}
		if outcome.Refusal != "" {
			log.Debugf("chat: 0x7367 refused for %s: %s", character.Name, outcome.Refusal)
			return
		}
		if outcome.Broadcast != nil {
			hub.BroadcastFunc(AllChatAccept(s, divisionID), OpChatBroadcast, outcome.Broadcast)
		}
		if presence == nil {
			return
		}
		for _, delivery := range outcome.Deliveries {
			if peer, online := presence.SessionByName(divisionID, delivery.TargetName); online {
				_ = peer.Send(OpChatBroadcast, delivery.Payload)
			}
		}
	}
}
