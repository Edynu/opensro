package quest

import (
	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/transport"
)

// Register wires the quest lane's two inbound handlers onto the hub:
// 0x71EB give-up and 0x729A reward-select, each registered here and
// NOWHERE else (hub registration is last-write-wins; the community
// register.go survey lists every sibling lane's opcodes - neither of
// these collides). Called from server wiring with the SAME deps pointer
// every other lane retains.
//
// Identity comes from the session bind only (enterworld.SessionCharacter
// - never a client-supplied name). Refusals return the native acknowledgement
// to the requester so its transaction can settle. Success answers the acting
// session with the authoritative 0x31ED update plus
// any payout burst, then publishes a reward's gid-only level-up presentation
// to other sessions in the same division.
func Register(hub *transport.Hub, rt *Runtime) {
	hub.Handle(OpQuestGiveUpRequest, questHubHandler(hub, rt, "0x71EB give-up", rt.HandleGiveUp))
	hub.Handle(OpQuestRewardRequest, questHubHandler(hub, rt, "0x729A reward-select", rt.HandleRewardSelect))
}

// questHubHandler adapts one runtime core onto the hub: bind the authority
// character, answer its private result and fan out only the public projection.
func questHubHandler(hub *transport.Hub, rt *Runtime, label string, op func(*enterworld.Character, []byte) (OpResult, error)) transport.HandlerFunc {
	return func(s *transport.Session, opcode uint16, payload []byte) {
		character, divisionID, bound := enterworld.SessionCharacter(rt.deps, s)
		if !bound {
			log.Debugf("quest: 0x%04X from unbound session %d discarded", opcode, s.ID)
			return
		}
		result, err := op(character, payload)
		if err != nil {
			log.Warnf("quest: %s refused for %s: %v", label, character.Name, err)
			// Native 75c370 / 75c3d0 consume [result=2, error:u8]. Zero is
			// our unspecified refusal policy, NOT a recovered retail reason
			// mapping. B1EB error 4 has a specific not-allowed message; do not
			// assign it to unrelated inventory/persistence/validation failures.
			ack := uint16(0xB29A)
			if opcode == OpQuestGiveUpRequest {
				ack = 0xB1EB
			}
			sendFrames(s, []wire.Frame{{Opcode: ack, Payload: []byte{2, 0}}})
			return
		}
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
			log.Debugf("quest: send 0x%04X to session %d failed: %v", frame.Opcode, s.ID, err)
			return
		}
	}
}
