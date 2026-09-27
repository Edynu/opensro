package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
)

// HandleVisualFlags owns the full retail 0x7683 -> 0xB683 round trip. The
// client is allowed to change only beginner bit 0; bit 1 belongs to the
// attached-state-effect owner and must be preserved. Above level 19 the
// beginner mark is forced off, matching the native option gate and tooltip.
func (rt *Runtime) HandleVisualFlags(
	_ string,
	character *enterworld.Character,
	payload []byte,
) OpResult {
	requested, err := wire.DecodeVisualFlagsRequest(payload)
	if err != nil || character == nil || character.DeletePending {
		return OpResult{}
	}

	var committed uint8
	applied := rt.deps.Update(character, "visual-flags", func() bool {
		current := enterworld.ResolveVisualFlags(character)
		// Unknown bits and changes to the effect bit are forged ownership.
		if requested&^enterworld.VisualFlagsKnownMask != 0 ||
			(requested&enterworld.VisualFlagEffect) != (current&enterworld.VisualFlagEffect) {
			return false
		}
		level := int64(1)
		if character.Level != nil {
			level = *character.Level
		}
		committed = requested & enterworld.VisualFlagsKnownMask
		if level > enterworld.BeginnerMarkMaxLevel {
			committed &^= enterworld.VisualFlagBeginner
		}
		value := int64(committed)
		character.VisualFlags = &value
		return true
	})
	if !applied {
		return OpResult{}
	}

	frame := wire.Frame{
		Opcode:  wire.OpVisualFlagsUpdate,
		Payload: wire.EncodeVisualFlagsUpdate(enterworld.ObjectIDForCharacter(character), committed),
	}
	return OpResult{Frames: []wire.Frame{frame}, Broadcast: []wire.Frame{frame}}
}
