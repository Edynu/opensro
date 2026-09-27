package wire

import (
	"bytes"
	"testing"
)

func TestAvatarInventorySlot7StackCountFrame(t *testing.T) {
	frame := AvatarInventorySlot7StackCountFrame(249)
	if frame.Opcode != 0x3752 || !bytes.Equal(frame.Payload, []byte{0xF9, 0x00}) {
		t.Fatalf("slot-7 count frame = 0x%04X % X, want 0x3752 F9 00", frame.Opcode, frame.Payload)
	}
}
