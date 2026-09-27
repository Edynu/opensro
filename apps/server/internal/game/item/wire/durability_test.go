package wire

import (
	"bytes"
	"testing"
)

func TestDurabilityBuildAndPayload(t *testing.T) {
	f := ItemDurabilityFrame(6, 0x89abcdef)
	if f.Opcode != 0x31e8 || !bytes.Equal(f.Payload, []byte{6, 0xef, 0xcd, 0xab, 0x89}) {
		t.Fatalf("%+v", f)
	}
	g := ItemDurabilityFrame(7, 0)
	f.Payload[1] = 1
	if !bytes.Equal(g.Payload, []byte{7, 0, 0, 0, 0}) {
		t.Fatal("shared payload")
	}
}
