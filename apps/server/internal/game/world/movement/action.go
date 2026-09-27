// Action-pane commands on the motion lane: the 0x324B emote/action channel
// and the 0x7025 fortress war horn. Both requests originate from the same
// client dispatcher as sit/stand and run/walk (sub_695420 /
// CGInterface_ExecuteActionCommand), and the emote's whole effect is a
// SetMotionState on every viewing client - the same plane the rest of this
// package drives - so they live here rather than in the item or stat lanes
// (progression is explicitly a no-broadcast plane; action is the item plane).
//
// Wire contracts: internal/game/item/wire/actionemote.go (client fold addresses cited
// there per constant).
package movement

import (
	"fmt"

	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/transport"
)

// ActionOutcome is one handled action command: the frames for the acting
// session, the frames for the division peers (origin excluded by the
// register glue), and the refusal reason when the request was rejected.
// Refusals ship NO packets: the emote channel has no error consumer in the
// client at all (the only inbound 0x324B path is the play push), and the
// war-horn notice bytes are unpinned (see HandleWarHorn) - so the wire
// stays silent and the reason lives in the log, the same convention as a
// refused move.
type ActionOutcome struct {
	Frames    []wire.Frame
	Broadcast []wire.Frame
	Refusal   string
}

func refusedAction(reason string) ActionOutcome {
	return ActionOutcome{Refusal: reason}
}

// RegisterActions wires the action-pane handlers (0x324B emote, 0x7025 war
// horn) onto the hub. Kept separate from Register so the movement lane and
// the action lane can land independently; server.go calls both.
func (rt *Runtime) RegisterActions(hub *transport.Hub) {
	hub.Handle(wire.OpActionEmote, rt.actionHubHandler(hub, rt.HandleActionEmote))
	hub.Handle(wire.OpWarHornRequest, rt.actionHubHandler(hub, rt.HandleWarHorn))
}

// actionOpFunc is one transport-free action operation.
type actionOpFunc func(divisionID string, character *enterworld.Character, payload []byte) ActionOutcome

// actionHubHandler adapts an action operation onto the hub: resolve the
// bound character (never trust client-supplied identity on later frames),
// run the op, answer the acting session, and fan the broadcast frames to
// division peers - the action fan-out convention. An unbound session is
// discarded silently: the retail client cannot compose these frames before
// enter-world (the Action pane lives in the mission scene).
func (rt *Runtime) actionHubHandler(hub *transport.Hub, op actionOpFunc) transport.HandlerFunc {
	return func(s *transport.Session, opcode uint16, payload []byte) {
		character, divisionID, bound := enterworld.SessionCharacter(rt.deps, s)
		if !bound {
			log.Debugf("movement: 0x%04X from unbound session %d discarded", opcode, s.ID)
			return
		}
		outcome := op(divisionID, character, payload)
		if outcome.Refusal != "" {
			log.Debugf("movement: 0x%04X refused for %s: %s", opcode, character.Name, outcome.Refusal)
		}
		for _, frame := range outcome.Frames {
			if err := s.Send(frame.Opcode, frame.Payload); err != nil {
				log.Debugf("movement: send 0x%04X to session %d failed: %v", frame.Opcode, s.ID, err)
				return
			}
		}
		if len(outcome.Broadcast) == 0 {
			return
		}
		broadcastObservedMotion(hub, divisionID, s.ID, enterworld.ObjectIDForCharacter(character), outcome.Broadcast)
	}
}

func broadcastObservedMotion(hub *transport.Hub, division string, exceptSession uint64, sourceGID uint32, frames []wire.Frame) {
	batch := make([]transport.Frame, len(frames))
	for i, frame := range frames {
		batch[i] = transport.Frame{Opcode: frame.Opcode, Payload: frame.Payload, Current: frame.Current, Scope: transport.ScopeChanges(frame.Scope)}
	}
	hub.BroadcastObserved(division, exceptSession, sourceGID, batch)
}

// HandleActionEmote answers a C->S 0x324B emote request: strict decode
// (exactly one byte, inside the client-emittable space 0..6), then the
// S->C 0x324B play push {u32 gid, u8 action} to the acting session AND the
// division peers. The sender gets its own copy because the native client
// does NOT animate locally on send - the emote only plays when the push
// comes back (sub_695420's emote arms emit the packet and return; the only
// SetMotionState path is the inbound sub_778190).
//
// No state persists and nothing mutates: motion state 7 is a transient
// one-shot animation on every client (the same state the idle-fidget timer
// enters), which is why there is no Mutate door here, unlike a move.
func (rt *Runtime) HandleActionEmote(divisionID string, character *enterworld.Character, payload []byte) ActionOutcome {
	if character == nil {
		return refusedAction("characterNotFound")
	}

	unlock := rt.lockCharacter(divisionID, character.Name)
	defer unlock()

	snapshot := rt.characterSnapshot(divisionID, character)
	if snapshot == nil || snapshot.DeletePending {
		return refusedAction("deletePending")
	}
	action, err := wire.DecodeActionEmoteRequest(payload)
	if err != nil {
		return refusedAction(err.Error())
	}

	push := wire.ActionEmotePush{
		Gid:    enterworld.ObjectIDForCharacter(character),
		Action: action,
	}
	frame := wire.Frame{Opcode: wire.OpActionEmote, Payload: push.Encode()}
	return ActionOutcome{
		Frames:    []wire.Frame{frame},
		Broadcast: []wire.Frame{frame},
	}
}

// HandleWarHorn answers a C->S 0x7025 fortress war horn: strict decode
// (exactly one u32 war id), then an unconditional REFUSAL, because this
// server holds no fortress-war state at all - there is no war table to
// validate the id against, so every id is unknown and accepting any would
// be more permissive than retail (which resolves the id against the live
// GuildWarTable the client mirrored it from).
//
// The refusal is SILENT by evidence, not by laziness: the client's only
// consumer is the 0xB025 notice (sub_7674c0, [u8 flag][u8 code if flag==2]
// -> notice 0x1f), and the exact flag/code bytes the retail GameServer
// emits are unpinned (C2 verify, server-wave seq 43) - emitting guessed
// bytes would invent a wire contract. A retail-faithful ACCEPT would also
// have to drive the 0x3792 [02][05][u32 seconds] action-cooldown re-arm;
// both belong to the wave that lands fortress-war state. Until then the
// request cannot even be composed by the retail UI here (the client
// refuses locally while no fortress war is live), so anything arriving is
// hostile or future - logged, never answered.
func (rt *Runtime) HandleWarHorn(divisionID string, character *enterworld.Character, payload []byte) ActionOutcome {
	if character == nil {
		return refusedAction("characterNotFound")
	}

	unlock := rt.lockCharacter(divisionID, character.Name)
	defer unlock()

	snapshot := rt.characterSnapshot(divisionID, character)
	if snapshot == nil || snapshot.DeletePending {
		return refusedAction("deletePending")
	}
	warID, err := wire.DecodeWarHornRequest(payload)
	if err != nil {
		return refusedAction(err.Error())
	}
	return refusedAction(fmt.Sprintf(
		"warId %d unknown: no fortress-war state on this server; 0xB025 refusal bytes unpinned vs retail, wire stays silent", warID))
}
