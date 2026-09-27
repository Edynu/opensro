package enterworld

import (
	"encoding/binary"
	"fmt"
	"time"

	log "github.com/sirupsen/logrus"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/transport"
)

// OpcodeEventGuideAck is the C->S event-guide seen-state ack
// (server.mjs missionEventGuideAckOpcode). SCOUT-B PIN 673 (REV-1 ACCEPT
// 683): the payload is EXACTLY [u32le stateMask], 4 bytes, sent raw by the
// Alpha client via sendNative. Like the Node reference handler
// (ackMissionEventGuideState) the native arm pushes NO reply frame — the
// mask persists onto the character record and becomes visible on the next
// enter-world bootstrap (blob + local-player entry).
const OpcodeEventGuideAck uint16 = 0x707B

// EventGuideTimestampLayout matches Date.toISOString(): UTC, milliseconds,
// trailing Z — the shape already persisted in the character state files.
const EventGuideTimestampLayout = "2006-01-02T15:04:05.000Z"

// HandleEventGuideAck applies the exact u32le payload to the authoritative
// mission record through the character mutation door. Extra mission fields
// survive the copy-then-swap; malformed payloads change nothing.
func HandleEventGuideAck(deps *Deps, character *Character, payload []byte, now time.Time) (uint32, error) {
	if character == nil {
		return 0, fmt.Errorf("bootstrap: eventGuideAck with no character")
	}
	if len(payload) != 4 {
		return 0, fmt.Errorf("bootstrap: eventGuideAck payload %d bytes, want exactly 4 (SCOUT-B PIN 673)", len(payload))
	}
	mask := binary.LittleEndian.Uint32(payload)

	deps.Mutate(character, "eventguide-mask", func() {
		// Copy-then-swap like the move lane's world write-back: aliases of
		// the old mission record (character snapshots) stay unchanged, and
		// the Node {...mission} spread semantics are preserved. The domain
		// publication lock nests inside the store door and stays a leaf.
		domain.MutateMission(character, func(current *domain.MissionRuntime) domain.MissionRuntime {
			next := domain.MissionRuntime{}
			if current != nil {
				next = *current
			}
			mask64 := int64(mask)
			next.EventGuideStateMask = &mask64
			next.EventGuideStateMaskUpdatedAt = now.UTC().Format(EventGuideTimestampLayout)
			return next
		})
	})
	return mask, nil
}

// RegisterEventGuideAck registers the 0x707B handler: resolve the bound
// character through the session identity keys (never the client-supplied
// name), apply the mask, push nothing. Unbound sessions and malformed
// payloads drop the frame with a log line, mirroring the move lane's
// silent-refusal posture; evicted sessions never reach here (the Hub
// dispatch drops game frames for lame ducks).
func RegisterEventGuideAck(hub *transport.Hub, deps *Deps) {
	hub.Handle(OpcodeEventGuideAck, func(s *transport.Session, _ uint16, payload []byte) {
		character, _, bound := SessionCharacter(deps.Characters, s)
		if !bound {
			log.Debug("bootstrap: 0x707B before enter-world bind ignored")
			return
		}
		mask, err := HandleEventGuideAck(deps, character, payload, time.Now())
		if err != nil {
			log.Debugf("bootstrap: 0x707B refused for %s: %v", character.Name, err)
			return
		}
		log.Debugf("bootstrap: event-guide mask for %s = 0x%08X", character.Name, mask)
	})
}
