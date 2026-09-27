package wire

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestGMRestrictionNoticePackedDate(t *testing.T) {
	// Hand-written shifts pin client-readable year/month/day/hour/minute/second.
	date := [8]uint16{2026, 9, 2, 22, 13, 45, 30, 999}
	want := uint32(26 | 9<<6 | 22<<10 | 13<<15 | 45<<20 | 30<<26)
	for _, kind := range []uint8{0, 1} {
		got := EncodeGMRestrictionNotice(kind, date)
		if len(got) != 5 || got[0] != kind || binary.LittleEndian.Uint32(got[1:]) != want {
			t.Fatalf("%x", got)
		}
	}
	date[2], date[7] = 0, 0
	if !bytes.Equal(EncodeGMRestrictionNotice(0, date), EncodeGMRestrictionNotice(0, [8]uint16{2026, 9, 6, 22, 13, 45, 30, 999})) {
		t.Fatal("weekday/milliseconds entered wire")
	}
	got := EncodeGMRestrictionNotice(1, [8]uint16{65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535})
	if binary.LittleEndian.Uint32(got[1:]) != 0xffffffef {
		t.Fatalf("native mask/wrap changed: %x", got)
	}
}
