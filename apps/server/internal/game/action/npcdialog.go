package action

import (
	"errors"
	"fmt"
	"sync"

	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/transport"
)

// NpcQuestOption is one server-owned row inserted into native kind-4 NPC
// dialog. Title and prompt are shipped text symbols; Codename is never sent.
type NpcQuestOption struct {
	Codename             string
	TitleSymbol          string
	PromptSymbol         string
	AcceptResponseSymbol string
	DenyResponseSymbol   string
	Informational        bool
	Complete             bool
}

// NpcQuestHooks is the anti-corruption boundary between NPC selection/dialog
// ownership and quest persistence. The quest runtime never learns selected
// gids or 0x3773 row numbers; action never mutates quest records itself.
type NpcQuestHooks struct {
	Options func(divisionID string, character *enterworld.Character, npcCodename string) []NpcQuestOption
	Accept  func(character *enterworld.Character, codename string) ([]wire.Frame, error)
	Finish  func(character *enterworld.Character, codename, npcCodename string) ([]wire.Frame, error)
}

type npcDialogStage uint8

const (
	npcDialogOptions npcDialogStage = iota + 1
	npcDialogConfirm
)

type npcDialogSession struct {
	NpcGID        uint32
	NpcCode       string
	DefaultSymbol string
	Stage         npcDialogStage
	Options       []NpcQuestOption
	Pending       NpcQuestOption
}

// NpcDialogStore is an ephemeral character-keyed conversation. It is cleared
// on selection replacement, target release and mission exit, preventing a
// delayed one-byte choice from applying to a different NPC.
type NpcDialogStore struct {
	mu          sync.Mutex
	byCharacter map[string]npcDialogSession
}

func NewNpcDialogStore() *NpcDialogStore {
	return &NpcDialogStore{byCharacter: make(map[string]npcDialogSession)}
}

func (s *NpcDialogStore) Put(divisionID, characterName string, session npcDialogSession) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session.Options = append([]NpcQuestOption(nil), session.Options...)
	s.byCharacter[selectionKey(divisionID, characterName)] = session
}

func (s *NpcDialogStore) Get(divisionID, characterName string) (npcDialogSession, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.byCharacter[selectionKey(divisionID, characterName)]
	session.Options = append([]NpcQuestOption(nil), session.Options...)
	return session, ok
}

func (s *NpcDialogStore) Clear(divisionID, characterName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.byCharacter, selectionKey(divisionID, characterName))
}

func (rt *Runtime) registerNpcDialogResponse(hub *transport.Hub) {
	hub.Handle(wire.OpNpcDialog, func(session *transport.Session, opcode uint16, payload []byte) {
		character, divisionID, bound := enterworld.SessionCharacter(rt.deps, session)
		if !bound {
			return
		}
		frames, refusal := rt.HandleNpcDialogResponse(divisionID, character, payload)
		if refusal != "" {
			log.Debugf("npcdialog: response refused for %s: %s", character.Name, refusal)
			return
		}
		sendFrames(session, frames)
		if public := wire.ProgressionBroadcastFrames(frames); len(public) > 0 && rt.PushDivisionPeerFrames != nil {
			rt.PushDivisionPeerFrames(divisionID, character.Name, public)
		}
	})
}

// HandleNpcDialogResponse consumes the exact one-byte native choice. Every
// choice is rebound to the still-live selected NPC before it can call a quest
// mutation hook.
func (rt *Runtime) HandleNpcDialogResponse(divisionID string, character *enterworld.Character, payload []byte) ([]wire.Frame, string) {
	choice, err := wire.DecodeNpcDialogChoice(payload)
	if err != nil {
		return nil, err.Error()
	}
	conversation, ok := rt.NpcDialogs.Get(divisionID, character.Name)
	if !ok {
		// Informational Confirm terminates the interaction: later server
		// 516670 -> 5107C0, v1.150 client 761820 closes on B4B3 [1].
		// Re-sending the base prompt creates an endless Confirm loop.
		if choice == 1 {
			if selected, bound := rt.Selected.Get(divisionID, character.Name); bound {
				if _, live := rt.npcForCurrentViewer(divisionID, character, selected); live {
					outcome := rt.HandleTargetRelease(divisionID, character, wire.NewWriter(4).U32(selected).Payload())
					return outcome.Frames, outcome.Refusal
				}
			}
		}
		return nil, "no active NPC dialog"
	}
	selected, ok := rt.Selected.Get(divisionID, character.Name)
	if !ok || selected != conversation.NpcGID {
		rt.NpcDialogs.Clear(divisionID, character.Name)
		return nil, "dialog NPC is no longer selected"
	}
	if _, live := rt.npcForCurrentViewer(divisionID, character, selected); !live {
		rt.NpcDialogs.Clear(divisionID, character.Name)
		return nil, "dialog NPC is no longer live/in scope"
	}

	switch conversation.Stage {
	case npcDialogOptions:
		if choice < 5 || int(choice-5) >= len(conversation.Options) {
			return nil, fmt.Sprintf("choice %d is outside %d option row(s)", choice, len(conversation.Options))
		}
		conversation.Pending = conversation.Options[int(choice-5)]
		if conversation.Pending.Informational {
			rt.NpcDialogs.Clear(divisionID, character.Name)
			return []wire.Frame{{Opcode: wire.OpNpcDialog, Payload: wire.EncodeNpcDialogSymbol(conversation.Pending.PromptSymbol)}}, ""
		}
		conversation.Stage = npcDialogConfirm
		conversation.Options = nil
		rt.NpcDialogs.Put(divisionID, character.Name, conversation)
		return []wire.Frame{{Opcode: wire.OpNpcDialog, Payload: wire.EncodeNpcDialogConfirm(conversation.Pending.PromptSymbol)}}, ""
	case npcDialogConfirm:
		if choice == 3 {
			rt.NpcDialogs.Clear(divisionID, character.Name)
			symbol := conversation.Pending.DenyResponseSymbol
			if symbol == "" {
				symbol = conversation.DefaultSymbol
			}
			return []wire.Frame{{Opcode: wire.OpNpcDialog, Payload: wire.EncodeNpcDialogSymbol(symbol)}}, ""
		}
		if choice != 2 {
			return nil, fmt.Sprintf("confirm choice %d is neither yes(2) nor no(3)", choice)
		}
		var frames []wire.Frame
		if conversation.Pending.Complete {
			if rt.NpcQuests.Finish == nil {
				return nil, "quest completion owner is unavailable"
			}
			frames, err = rt.NpcQuests.Finish(character, conversation.Pending.Codename, conversation.NpcCode)
		} else {
			if rt.NpcQuests.Accept == nil {
				return nil, "quest acceptance owner is unavailable"
			}
			frames, err = rt.NpcQuests.Accept(character, conversation.Pending.Codename)
		}
		if err != nil {
			var localized interface {
				error
				DialogueSymbol() string
			}
			if errors.As(err, &localized) && localized.DialogueSymbol() != "" {
				rt.NpcDialogs.Clear(divisionID, character.Name)
				return []wire.Frame{{Opcode: wire.OpNpcDialog, Payload: wire.EncodeNpcDialogSymbol(localized.DialogueSymbol())}}, ""
			}
			// Eligibility may change after the offer (level, inventory or quest
			// state). End this confirmation and answer with the authored base
			// prompt; never keep a stale Yes action or silently strand a request.
			log.Debugf("npcdialog: quest %s refused: %v", conversation.Pending.Codename, err)
			rt.NpcDialogs.Clear(divisionID, character.Name)
			return []wire.Frame{{Opcode: wire.OpNpcDialog, Payload: wire.EncodeNpcDialogSymbol(conversation.DefaultSymbol)}}, ""
		}
		rt.NpcDialogs.Clear(divisionID, character.Name)
		symbol := conversation.Pending.AcceptResponseSymbol
		if symbol == "" {
			symbol = conversation.DefaultSymbol
		}
		return append(frames, wire.Frame{Opcode: wire.OpNpcDialog, Payload: wire.EncodeNpcDialogSymbol(symbol)}), ""
	default:
		return nil, "unknown NPC dialog stage"
	}
}
