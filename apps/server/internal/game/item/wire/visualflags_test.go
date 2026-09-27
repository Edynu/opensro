package wire

import (
	"bytes"
	"testing"
)

func TestVisualFlagsWireUsesOneCompleteByteAndEntityUpdate(t *testing.T) {
	if got, err := DecodeVisualFlagsRequest([]byte{0x03}); err != nil || got != 0x03 {
		t.Fatalf("DecodeVisualFlagsRequest = 0x%X/%v, want 0x03/nil", got, err)
	}
	for _, malformed := range [][]byte{nil, {}, {1, 2}} {
		if _, err := DecodeVisualFlagsRequest(malformed); err == nil {
			t.Fatalf("DecodeVisualFlagsRequest(% X) accepted non-one-byte body", malformed)
		}
	}
	if got, want := EncodeVisualFlagsUpdate(0x01020304, 0x03), []byte{4, 3, 2, 1, 3}; !bytes.Equal(got, want) {
		t.Fatalf("EncodeVisualFlagsUpdate = % X, want % X", got, want)
	}
}
