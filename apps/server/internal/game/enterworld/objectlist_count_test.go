package enterworld

// Count-field boundary tests for the u8->u16 object-list start fix and
// the u8 count clamps: past 255 rows the start packet's count is a proper
// LE u16 (the encoding monstertick.go's despawn bracket always used), and
// every u8-counted list clamps its bodies with its count so the two can
// never disagree on the wire.

import (
	"bytes"
	"fmt"
	"testing"
)

// buildCountedObjectListPackets drives buildBootstrapPackets with n
// synthetic object rows and returns the start payload plus the number of
// row packets emitted between the start and finalize brackets.
func buildCountedObjectListPackets(t *testing.T, n int) (startPayload []int, rowCount int) {
	t.Helper()
	deps := &Deps{ObjectListRows: func(string, *Character, *LocalPlayerEntry) []Packet {
		rows := make([]Packet, n)
		for i := range rows {
			rows[i] = NewPacket(OpcodeObjectListChunk, []byte{byte(i)})
		}
		return rows
	}}
	entry := &LocalPlayerEntry{StartProfile: StartProfileForRaceProfile()}

	packets, err := buildBootstrapPackets(deps, "global-official", &Character{Name: "rowcarrier"}, entry, nil, 100001)
	if err != nil {
		t.Fatal(err)
	}

	startIndex := -1
	finalizeIndex := -1
	for i, packet := range packets {
		switch packet.NativeOpcode {
		case OpcodeObjectListStart:
			startIndex = i
		case OpcodeObjectListFinalize:
			finalizeIndex = i
		}
	}
	if startIndex < 0 || finalizeIndex < 0 || finalizeIndex < startIndex {
		t.Fatalf("object-list bracket missing: start=%d finalize=%d", startIndex, finalizeIndex)
	}
	return packets[startIndex].Payload, finalizeIndex - startIndex - 1
}

// TestObjectListStartCountIsLittleEndianU16: at 256 and 300 rows the count
// field carries the real row count as LE u16 (the old hardcoded 0x00 high
// byte truncated it mod 256), and every row still emits.
func TestObjectListStartCountIsLittleEndianU16(t *testing.T) {
	cases := []struct {
		rows int
		want []int
	}{
		{rows: 256, want: []int{0x01, 0x00, 0x01}},
		{rows: 300, want: []int{0x01, 0x2c, 0x01}},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%d-rows", tc.rows), func(t *testing.T) {
			payload, rowCount := buildCountedObjectListPackets(t, tc.rows)
			if len(payload) != 3 || payload[0] != tc.want[0] || payload[1] != tc.want[1] || payload[2] != tc.want[2] {
				t.Fatalf("start payload = %v, want %v", payload, tc.want)
			}
			if rowCount != tc.rows {
				t.Fatalf("emitted %d row packets, want %d", rowCount, tc.rows)
			}
		})
	}
}

// TestObjectListStartCountBelow256StaysByteIdentical: the fixed encoder's
// high byte is genuinely zero below 256, so the frozen fixture sequences
// (which never approach the boundary) carry the exact bytes they always
// did.
func TestObjectListStartCountBelow256StaysByteIdentical(t *testing.T) {
	payload, rowCount := buildCountedObjectListPackets(t, 7)
	want := []int{0x01, 0x07, 0x00}
	if len(payload) != 3 || payload[0] != want[0] || payload[1] != want[1] || payload[2] != want[2] {
		t.Fatalf("start payload = %v, want %v", payload, want)
	}
	if rowCount != 7 {
		t.Fatalf("emitted %d row packets, want 7", rowCount)
	}
}

// TestObjectListRowsClampAtTheU16Ceiling: past 65535 rows the emitted rows
// hard-cap so the count field can never disagree with the body (no
// multi-frame paging contract is pinned; truncate-and-log is the posture).
func TestObjectListRowsClampAtTheU16Ceiling(t *testing.T) {
	payload, rowCount := buildCountedObjectListPackets(t, 0x10000+5)
	want := []int{0x01, 0xff, 0xff}
	if len(payload) != 3 || payload[0] != want[0] || payload[1] != want[1] || payload[2] != want[2] {
		t.Fatalf("start payload = %v, want %v", payload, want)
	}
	if rowCount != 0xffff {
		t.Fatalf("emitted %d row packets, want %d (the u16 ceiling)", rowCount, 0xffff)
	}
}

// TestCharDataSkillListClampsAtTheU8Count: skill learning has no cap, so a
// record past 255 learned skills must emit count 255 with exactly 255
// bodies - the wrapped count byte the unclamped writer produced desynced
// the client stream.
func TestCharDataSkillListClampsAtTheU8Count(t *testing.T) {
	skills := make([]uint32, 300)
	for i := range skills {
		skills[i] = uint32(i + 1)
	}
	character := &Character{
		ID:     1,
		Name:   "skillhoarder",
		Skills: skills,
	}
	entry := &LocalPlayerEntry{StartProfile: StartProfileForRaceProfile()}

	payload := BuildLocalPlayerEntryPayload(character, entry, 0, nil)

	// The expected subsequence: empty mastery framing, skill count 255,
	// then exactly 255 marker-framed bodies (ids 1..255) and the end
	// marker before the empty quest block.
	var want bytes.Buffer
	want.Write([]byte{0x00, 0x02}) // mastery list: count 0, end marker
	want.WriteByte(0xff)           // skill count, clamped
	for i := 1; i <= 0xff; i++ {
		want.Write([]byte{0x01, byte(i), byte(i >> 8), 0x00, 0x00, 0x01})
	}
	want.Write([]byte{0x02})             // skill end marker
	want.Write([]byte{0x00, 0x00, 0x00}) // empty quest block
	if !bytes.Contains(payload, want.Bytes()) {
		t.Fatal("char-data payload does not carry the clamped 255-body skill list")
	}
}
