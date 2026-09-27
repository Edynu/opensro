package wire

import "fmt"

// Target release closes a server-owned NPC interaction.
//
// v1.150 byte truth:
//   - C->S sub_693790 / CGInterface_SendTargetRelease74B3:
//     0x74B3 [trackedTargetGid624:u32le]
//   - S->C sub_761820 / CPSMission_HandleTalkCloseB4B3:
//     0xB4B3 [mode:u8] ([extra:u8] only when mode == 2)
//
// Mode 1 is the minimal close acknowledgement: the client unconditionally
// runs sub_69fff0's interaction-window sweep and needs no extra byte.
const (
	OpTargetReleaseRequest uint16 = 0x74B3
	OpTalkCloseResult      uint16 = 0xB4B3
)

// TargetReleaseRequestSize is exactly one little-endian object gid.
const TargetReleaseRequestSize = 4

// DecodeTargetReleaseRequest parses the exact sub_693790 request body.
func DecodeTargetReleaseRequest(payload []byte) (uint32, error) {
	if len(payload) != TargetReleaseRequestSize {
		return 0, fmt.Errorf(
			"wire: 0x74B3 body %d bytes, want exactly %d",
			len(payload),
			TargetReleaseRequestSize,
		)
	}
	reader := NewReader(payload)
	gid, err := reader.U32()
	if err != nil {
		return 0, err
	}
	return gid, nil
}

// EncodeTalkCloseResult composes 0xB4B3 mode 1. Do not append an invented
// success byte: sub_761820 interprets this first byte as a mode selector.
func EncodeTalkCloseResult() []byte {
	return []byte{1}
}
