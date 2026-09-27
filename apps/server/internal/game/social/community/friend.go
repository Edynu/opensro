package community

import (
	"fmt"
	"strings"

	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/transport"
)

// FriendMaxCount is the client panel's row cap: the literal 0x14 in the
// sub_600f80 ": %d / %d" count write over the +0x7c4 pair list. The
// server enforces it on BOTH sides of the mutual edge so no persisted
// roster can exceed what the panel displays.
const FriendMaxCount = enterworld.FriendMaxCount

// 0x3F9A event-type bytes the client's sub_760fb0 jump table dispatches
// (cases 5/6/7 are table holes and anything outside 2..9 asserts - only
// these three are the friend lane's to compose; 8/9 belong to letters).
const (
	FriendEventAdded   uint8 = 2
	FriendEventDeleted uint8 = 3
	FriendEventState   uint8 = 4
)

// Friend state bytes (sub_828ea0 roster read / sub_827380 case-4 write:
// 0 online flips the gil_contact_on art, 1 offline flips it off).
const (
	FriendStateOnline  uint8 = 0
	FriendStateOffline uint8 = 1
)

// DecodeFriendAddRequest strict-decodes the sub_704590 body
// {u16 len, ANSI name}: a non-empty name and no trailing bytes (the
// client's 0x8075 receiver sub_602180 already drops empty input, so an
// empty wire name is malformed, not a refusal).
func DecodeFriendAddRequest(payload []byte) (string, error) {
	reader := wire.NewReader(payload)
	nameLen, err := reader.U16()
	if err != nil {
		return "", err
	}
	nameBytes, err := reader.Bytes(int(nameLen))
	if err != nil {
		return "", err
	}
	if err := reader.Done(); err != nil {
		return "", err
	}
	if nameLen == 0 {
		return "", fmt.Errorf("community: friend-add name is empty")
	}
	return string(nameBytes), nil
}

// DecodeFriendDeleteRequest strict-decodes the sub_701990 body
// {u32 friendJid}.
func DecodeFriendDeleteRequest(payload []byte) (uint32, error) {
	reader := wire.NewReader(payload)
	jid, err := reader.U32()
	if err != nil {
		return 0, err
	}
	if err := reader.Done(); err != nil {
		return 0, err
	}
	return jid, nil
}

// EncodeFriendEventAdded3F9A renders the 0x3F9A case-2 body the client's
// sub_760fb0 @0x00761019 reads: u8 2, u32 jid, sized name, u32 model.
// The client inserts the record with state 0 (ONLINE) - the server only
// composes this event when both sides are live, so the hardcoded online
// insert is honest.
func EncodeFriendEventAdded3F9A(jid uint32, name string, modelRefID uint32) []byte {
	writer := wire.NewWriter(12 + len(name))
	writer.U8(FriendEventAdded)
	writer.U32(jid)
	writeSizedString(writer, name)
	writer.U32(modelRefID)
	return writer.Payload()
}

// EncodeFriendEventDeleted3F9A renders the 0x3F9A case-3 body
// (sub_760fb0 @0x007610e9): u8 3, u32 jid. The client's erase THROWS on
// a jid it does not list - only compose this toward a session whose
// roster is known to carry the jid.
func EncodeFriendEventDeleted3F9A(jid uint32) []byte {
	writer := wire.NewWriter(5)
	writer.U8(FriendEventDeleted)
	writer.U32(jid)
	return writer.Payload()
}

// EncodeFriendEventState3F9A renders the 0x3F9A case-4 body (sub_760fb0
// @0x00761125): u8 4, u32 jid, u8 state. The client dereferences the
// roster record UNGUARDED (@0x007611cd) - a state event for an unlisted
// jid is a native null-deref, so every send site guards on the
// receiver's persisted roster first.
func EncodeFriendEventState3F9A(jid uint32, state uint8) []byte {
	writer := wire.NewWriter(6)
	writer.U8(FriendEventState)
	writer.U32(jid)
	writer.U8(state)
	return writer.Payload()
}

// FriendJID projects a store character ID onto the u32 wire jid space. The
// authority store enforces domain.MaxCharacterID at load and allocation, so
// this projection cannot alias two characters.
func FriendJID(id int64) uint32 {
	return uint32(id)
}

// FriendModelRef resolves the model refObjId a friend edge carries: the
// same chain the local-player entry uses (explicit ModelRef field, then
// the roster codename lookup, then the race/gender start-profile
// fallback - bootstrap resolveModelRef's shape).
func FriendModelRef(deps Dependencies, c *enterworld.Character) uint32 {
	if c == nil {
		return 0
	}
	return deps.CharacterModelRef(c)
}

// FriendRosterEntries builds the 0x3769 roster rows from the persisted
// edges, deriving each state byte from LIVE presence at encode time (the
// state is never persisted - a reboot honestly reopens everyone offline
// until their session binds again). A nil presence reads all-offline.
func FriendRosterEntries(presence Presence, divisionID string, character *enterworld.Character) []FriendRosterEntry {
	edges := enterworld.FriendsView(character)
	if len(edges) == 0 {
		return nil
	}
	entries := make([]FriendRosterEntry, 0, len(edges))
	for _, edge := range edges {
		state := FriendStateOffline
		if presenceOnline(presence, divisionID, edge.Name) {
			state = FriendStateOnline
		}
		entries = append(entries, FriendRosterEntry{
			JID:        FriendJID(edge.ID),
			Name:       edge.Name,
			ModelRefID: edge.ModelRefID,
			State:      state,
		})
	}
	return entries
}

// findCharacterByName resolves a division character record by name,
// case-insensitively - the same EqualFold match the enter-world Build
// resolves with (CreateCharacter refuses case-insensitive duplicates, so
// the fold is unambiguous).
func findCharacterByName(deps Dependencies, divisionID, name string) *enterworld.Character {
	for _, candidate := range deps.CharactersForDivision(divisionID) {
		if candidate != nil && strings.EqualFold(candidate.Name, name) {
			return candidate
		}
	}
	return nil
}

// findCharacterByID resolves a division character record by store ID
// (the friend jid space).
func findCharacterByID(deps Dependencies, divisionID string, id int64) *enterworld.Character {
	for _, candidate := range deps.CharactersForDivision(divisionID) {
		if candidate != nil && candidate.ID == id {
			return candidate
		}
	}
	return nil
}

// friendListed reports whether the character's persisted roster carries
// the id - the guard every 0x3F9A case-3/case-4 send takes before
// composing toward a session (the client folds throw on unlisted jids).
func friendListed(character *enterworld.Character, id int64) bool {
	return friendIndex(character, id) >= 0
}

func friendIndex(character *enterworld.Character, id int64) int {
	for index, edge := range enterworld.FriendsView(character) {
		if edge.ID == id {
			return index
		}
	}
	return -1
}

// appendFriendEdge appends one already-validated edge while the caller holds
// the multi-character update door. Copy-then-swap publishes the new slice
// header to cross-session readers.
func appendFriendEdge(owner *enterworld.Character, edge enterworld.FriendRecord) {
	current := owner.Friends
	next := make([]enterworld.FriendRecord, 0, len(current)+1)
	next = append(next, current...)
	next = append(next, edge)
	enterworld.SwapFriends(owner, next)
}

// removeFriendEdgeAt removes one already-resolved edge while the caller holds
// the multi-character update door.
func removeFriendEdgeAt(owner *enterworld.Character, at int) {
	current := owner.Friends
	next := make([]enterworld.FriendRecord, 0, len(current)-1)
	next = append(next, current[:at]...)
	next = append(next, current[at+1:]...)
	enterworld.SwapFriends(owner, next)
}

// appendMutualFriendEdgesDoor installs both halves of a mutual edge in
// ONE multi-record door. Both lists are re-validated before either swap,
// so a concurrent duplicate/cap change leaves both records untouched.
func appendMutualFriendEdgesDoor(
	deps Dependencies,
	actor, target *enterworld.Character,
) (targetEdge, actorEdge enterworld.FriendRecord, applied bool) {
	applied = deps.UpdateMany([]*enterworld.Character{actor, target}, "friend-add", func() bool {
		if actor.DeletePending || target.DeletePending {
			return false
		}
		targetEdge = enterworld.FriendRecord{
			ID:         target.ID,
			Name:       target.Name,
			ModelRefID: FriendModelRef(deps, target),
		}
		actorEdge = enterworld.FriendRecord{
			ID:         actor.ID,
			Name:       actor.Name,
			ModelRefID: FriendModelRef(deps, actor),
		}
		if len(actor.Friends) >= FriendMaxCount || len(target.Friends) >= FriendMaxCount {
			return false
		}
		for _, edge := range actor.Friends {
			if edge.ID == targetEdge.ID {
				return false
			}
		}
		for _, edge := range target.Friends {
			if edge.ID == actorEdge.ID {
				return false
			}
		}
		// Both validations have passed under the same door. The two
		// copy-then-swap operations cannot refuse, so there is no partial
		// mutation or unwind path.
		appendFriendEdge(actor, targetEdge)
		appendFriendEdge(target, actorEdge)
		return true
	})
	return targetEdge, actorEdge, applied
}

// removeMutualFriendEdgesDoor removes both reciprocal edges in ONE
// multi-record door. Either-side drift refuses without mutation: current
// stores validate mutuality at boot, accepted adds are atomic, and final
// character deletion cascades inbound edges in its archive transaction.
func removeMutualFriendEdgesDoor(
	deps Dependencies,
	actor, target *enterworld.Character,
	targetID int64,
) (actorRemoved, targetRemoved bool) {
	deps.UpdateMany([]*enterworld.Character{actor, target}, "friend-delete", func() bool {
		if actor.DeletePending {
			return false
		}
		actorIndex := friendIndex(actor, targetID)
		targetIndex := friendIndex(target, actor.ID)
		if actorIndex < 0 || targetIndex < 0 {
			return false
		}
		removeFriendEdgeAt(actor, actorIndex)
		removeFriendEdgeAt(target, targetIndex)
		actorRemoved = true
		targetRemoved = true
		return true
	})
	return actorRemoved, targetRemoved
}

// FriendAddOutcome is one handled 0x7164 request. Refusal carries the
// log-only reason when nothing changed (SILENT on the wire - no
// friend-add refusal bytes are pinned in the client folds, the
// war-horn/COS convention). On success TargetEntry is the edge appended
// to the actor's roster (announced to the actor as 0x3F9A case 2) and
// ActorEntry the mutual edge appended to the target's roster (announced
// to the target's live session).
type FriendAddOutcome struct {
	Refusal     string
	TargetName  string
	TargetEntry enterworld.FriendRecord
	ActorEntry  enterworld.FriendRecord
}

func refusedFriendAdd(reason string) FriendAddOutcome {
	return FriendAddOutcome{Refusal: reason}
}

// HandleFriendAdd applies one 0x7164 request: resolve the target by the
// requested name within the actor's division, refuse the unpinned arms
// silently (self, unknown, delete-pending, offline, duplicate, either
// cap), then append the MUTUAL edge pair through one multi-record Mutate
// door - retail's _Friend stores one row per owner, so an accepted add
// writes both characters in one transaction. The target must be ONLINE
// (targetOnline): the
// client's case-2 insert hardcodes state 0 online (retail adds complete
// through a live consent peer), so accepting an offline target would
// paint a live contact icon on a player who is not there.
//
// The door re-validates both records inside the store lock before either
// edge lands. The old actor-side unwind is therefore dead: no accepted
// path exposes or commits only one half.
func HandleFriendAdd(deps Dependencies, divisionID string, actor *enterworld.Character, payload []byte, targetOnline func(name string) bool) FriendAddOutcome {
	if actor == nil {
		return refusedFriendAdd("characterNotFound")
	}
	name, err := DecodeFriendAddRequest(payload)
	if err != nil {
		return refusedFriendAdd(err.Error())
	}
	if strings.EqualFold(name, actor.Name) {
		return refusedFriendAdd("cannot befriend yourself")
	}
	target := findCharacterByName(deps, divisionID, name)
	if target == nil {
		return refusedFriendAdd(fmt.Sprintf("%q not found in division %s", name, divisionID))
	}
	if targetOnline == nil || !targetOnline(target.Name) {
		return refusedFriendAdd(fmt.Sprintf("%q is offline (a live add needs the peer's session for the case-2 online insert)", target.Name))
	}

	targetEdge, actorEdge, applied := appendMutualFriendEdgesDoor(deps, actor, target)
	if !applied {
		return refusedFriendAdd("mutual append refused inside the door (delete-pending, duplicate, or cap)")
	}
	return FriendAddOutcome{
		TargetName:  target.Name,
		TargetEntry: targetEdge,
		ActorEntry:  actorEdge,
	}
}

// FriendDeleteOutcome is one handled 0x75DB request. On success the
// actor's edge is gone (announce case 3 {FriendJID} to the actor);
// TargetRemoved reports whether the mutual edge was also removed from a
// live target record (announce case 3 {ActorJID} to the target's session
// - guarded, because the client's erase throws on an unlisted jid).
type FriendDeleteOutcome struct {
	Refusal       string
	FriendJID     uint32
	ActorJID      uint32
	TargetName    string
	TargetRemoved bool
}

func refusedFriendDelete(reason string) FriendDeleteOutcome {
	return FriendDeleteOutcome{Refusal: reason}
}

// HandleFriendDelete applies one 0x75DB request: remove the edge with
// the requested jid from the actor's roster, and the mutual edge from
// the target's record in the same mutation door. A missing target or
// missing reciprocal edge is authority drift and refuses without mutation.
// A jid the actor does not list refuses silently (the client only
// composes jids off its own roster, so a miss is a desync or a forged
// frame; no refusal bytes are pinned either way).
func HandleFriendDelete(deps Dependencies, divisionID string, actor *enterworld.Character, payload []byte) FriendDeleteOutcome {
	if actor == nil {
		return refusedFriendDelete("characterNotFound")
	}
	jid, err := DecodeFriendDeleteRequest(payload)
	if err != nil {
		return refusedFriendDelete(err.Error())
	}
	target := findCharacterByID(deps, divisionID, int64(jid))
	if target == nil {
		return refusedFriendDelete(fmt.Sprintf("friend target %d is not live in division %s", jid, divisionID))
	}
	actorRemoved, targetRemoved := removeMutualFriendEdgesDoor(deps, actor, target, int64(jid))
	if !actorRemoved {
		return refusedFriendDelete(fmt.Sprintf("jid %d is not a mutual live edge or the actor is delete-pending", jid))
	}
	outcome := FriendDeleteOutcome{
		FriendJID:     jid,
		ActorJID:      FriendJID(actor.ID),
		TargetRemoved: targetRemoved,
	}
	if target != nil {
		outcome.TargetName = target.Name
	}
	return outcome
}

// RegisterFriend wires the friend mutators onto the hub, replacing the
// former silent-refuse stubs: 0x7164 add and 0x75DB delete, each
// registered here and NOWHERE else (hub registration is last-write-wins;
// community.Register no longer touches these two). Identity comes from
// the session bind only; every refusal stays SILENT on the wire (no
// refusal bytes are pinned) and logs its reason; success answers with
// the client-parsed 0x3F9A events - case 2 to both live sides on add,
// case 3 to both on delete. Sends run AFTER the Mutate doors return
// (never inside the store lock).
func RegisterFriend(hub *transport.Hub, deps Dependencies, presence Presence) {
	hub.Handle(OpFriendAddRequest, func(s *transport.Session, opcode uint16, payload []byte) {
		actor, divisionID, bound := enterworld.SessionCharacter(deps, s)
		if !bound {
			log.Debugf("community: 0x%04X from unbound session %d discarded", opcode, s.ID)
			return
		}
		online := func(name string) bool { return presenceOnline(presence, divisionID, name) }
		outcome := HandleFriendAdd(deps, divisionID, actor, payload, online)
		if outcome.Refusal != "" {
			log.Debugf("community: 0x7164 (friend-add) refused for %s: %s", actor.Name, outcome.Refusal)
			return
		}
		entry := outcome.TargetEntry
		_ = s.Send(OpFriendLetterEventPush, EncodeFriendEventAdded3F9A(FriendJID(entry.ID), entry.Name, entry.ModelRefID))
		if peer, ok := presenceSession(presence, divisionID, outcome.TargetName); ok {
			mutual := outcome.ActorEntry
			_ = peer.Send(OpFriendLetterEventPush, EncodeFriendEventAdded3F9A(FriendJID(mutual.ID), mutual.Name, mutual.ModelRefID))
		}
		log.Debugf("community: %s and %s are now friends", actor.Name, outcome.TargetName)
	})
	hub.Handle(OpFriendDeleteRequest, func(s *transport.Session, opcode uint16, payload []byte) {
		actor, divisionID, bound := enterworld.SessionCharacter(deps, s)
		if !bound {
			log.Debugf("community: 0x%04X from unbound session %d discarded", opcode, s.ID)
			return
		}
		outcome := HandleFriendDelete(deps, divisionID, actor, payload)
		if outcome.Refusal != "" {
			log.Debugf("community: 0x75DB (friend-delete) refused for %s: %s", actor.Name, outcome.Refusal)
			return
		}
		_ = s.Send(OpFriendLetterEventPush, EncodeFriendEventDeleted3F9A(outcome.FriendJID))
		if outcome.TargetRemoved {
			if peer, ok := presenceSession(presence, divisionID, outcome.TargetName); ok {
				_ = peer.Send(OpFriendLetterEventPush, EncodeFriendEventDeleted3F9A(outcome.ActorJID))
			}
		}
		log.Debugf("community: %s removed friend jid %d (%s)", actor.Name, outcome.FriendJID, outcome.TargetName)
	})
}

// FriendWorldBound is the presence-online fanout, called from the
// server's OnWorldBound tail after the exclusive bind wins: every LIVE
// friend whose persisted roster carries this character receives 0x3F9A
// case 4 state=0 on their own session - the flip the client's contact
// icon and connect announce run without a re-enter. The binder's own
// roster needs no self-push: its 0x3769 seed was encoded with live
// presence moments earlier in the same enter-world. A rebind after an
// eviction fans out again; the client's state write is idempotent.
func FriendWorldBound(deps Dependencies, presence Presence, divisionID string, character *enterworld.Character) {
	if character == nil {
		return
	}
	event := EncodeFriendEventState3F9A(FriendJID(character.ID), FriendStateOnline)
	notifyFriendSessions(deps, presence, divisionID, character, event)
}

// FriendSessionClosed is the presence-offline fanout, called from the
// hub's OnSessionClose hook: resolve the closing session's bound
// character (an evicted loser had its name key cleared at bind time and
// resolves to nothing), skip when ANOTHER session already holds the bind
// key (the rebind winner is live - the character never went offline),
// then push case 4 state=1 to every live friend that lists them.
func FriendSessionClosed(deps Dependencies, presence Presence, s *transport.Session) {
	character, divisionID, bound := enterworld.SessionCharacter(deps, s)
	if !bound {
		return
	}
	if winner, live := presenceSession(presence, divisionID, character.Name); live && winner != s {
		return
	}
	event := EncodeFriendEventState3F9A(FriendJID(character.ID), FriendStateOffline)
	notifyFriendSessions(deps, presence, divisionID, character, event)
}

// notifyFriendSessions sends one prebuilt 0x3F9A frame to the live
// session of every friend edge whose OWN persisted roster still lists
// the character (the mutual invariant makes that the normal case; the
// guard exists because the client's case-4 handler null-derefs on an
// unlisted jid, so a half-removed edge must never receive the event).
func notifyFriendSessions(deps Dependencies, presence Presence, divisionID string, character *enterworld.Character, event []byte) {
	// Resolve reciprocal membership under the authority read door, but never
	// hold that door across presence lookup or a network send.
	characters := deps.CharactersForDivision(divisionID)
	var recipients []string
	deps.Read(divisionID, func() {
		for _, edge := range enterworld.FriendsView(character) {
			friend := characterByID(characters, edge.ID)
			if friend == nil || !friendListed(friend, character.ID) {
				continue
			}
			recipients = append(recipients, edge.Name)
		}
	})
	for _, name := range recipients {
		peer, ok := presenceSession(presence, divisionID, name)
		if !ok {
			continue
		}
		_ = peer.Send(OpFriendLetterEventPush, event)
	}
}

func characterByID(characters []*enterworld.Character, id int64) *enterworld.Character {
	for _, character := range characters {
		if character != nil && character.ID == id {
			return character
		}
	}
	return nil
}
