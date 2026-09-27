package enterworld

import (
	"encoding/binary"
	"fmt"
	"opensro.online/server/internal/domain"
)

// Subtype 2 shares the native quickslot configuration opcode 0x7541.
// There is no invented acknowledgment; re-entry is the durable readback.
func handleAutoPotionSave(deps *Deps, character *Character, payload []byte) (bool, error) {
	if len(payload) != 8 || payload[0] != 2 {
		return false, fmt.Errorf("auto-potion save requires subtype 2 and seven settings bytes")
	}
	if character == nil {
		return false, fmt.Errorf("character not found")
	}
	next := domain.AutoPotionSettings{
		HP: binary.LittleEndian.Uint16(payload[1:3]), MP: binary.LittleEndian.Uint16(payload[3:5]),
		Cure: binary.LittleEndian.Uint16(payload[5:7]), Timing: payload[7],
	}
	return deps.Update(character, "auto-potion-save", func() bool {
		if character.DeletePending || character.AutoPotion == next {
			return false
		}
		character.AutoPotion = next
		return true
	}), nil
}
