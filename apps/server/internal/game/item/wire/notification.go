package wire

import "unicode/utf16"

// v1.150 753A6F: chat type 7 contains only a sized UTF-16 string.
// 752ABD sends it to the notification banner and the chat log. This is a
// server-authored message, not an invented B245 skill-error number.
func NotificationFrame(message string) Frame {
	text := utf16.Encode([]rune(message))
	if len(text) > 100 {
		panic("notification exceeds text budget")
	}
	w := NewWriter(3 + 2*len(text)).U8(7).U16(uint16(len(text)))
	for _, ch := range text {
		w.U16(ch)
	}
	return Frame{Opcode: 0x3667, Payload: w.Payload()}
}
