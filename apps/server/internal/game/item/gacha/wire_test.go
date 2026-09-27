package gacha

import (
	"bytes"
	"testing"
)

func TestGachaWireContracts(t *testing.T) {
	request, err := DecodeRollRequest([]byte{
		0x78, 0x56, 0x34, 0x12,
		0xef, 0xcd, 0xab, 0x90,
		0x0d,
	})
	if err != nil {
		t.Fatalf("DecodeRollRequest: %v", err)
	}
	if request.BoundNpcGID != 0x12345678 ||
		request.SelectedEntryID != 0x90abcdef ||
		request.InventorySlot != 13 {
		t.Fatalf("DecodeRollRequest = %#v", request)
	}
	if _, err := DecodeRollRequest(make([]byte, 10)); err == nil {
		t.Fatal("DecodeRollRequest admitted trailing bytes")
	}

	gid, flags, err := DecodeNpcAction([]byte{
		0x04, 0x03, 0x02, 0x01,
		0x00, 0x00, 0x01, 0x00,
	})
	if err != nil || gid != 0x01020304 || flags != InteractionFlagGacha {
		t.Fatalf("DecodeNpcAction = gid=%#x flags=%#x err=%v", gid, flags, err)
	}
	if got, want := EncodeOpenInteraction(), []byte{1, 0, 0, 1, 0}; !bytes.Equal(got, want) {
		t.Fatalf("EncodeOpenInteraction = %x, want %x", got, want)
	}
	if got, want := EncodeResult(ResultWin), []byte{1, 1}; !bytes.Equal(got, want) {
		t.Fatalf("EncodeResult = %x, want %x", got, want)
	}
}

func TestResultCardDeltaContainsRewardForEitherOutcome(t *testing.T) {
	for _, ref := range []uint32{901, 902} {
		got := EncodeResultItemDelta(13, ref, 0x12345678, 10000)
		want := []byte{13, 0x21, byte(ref), byte(ref >> 8), 0, 0, 2, 0x78, 0x56, 0x34, 0x12, 0, 0, 0, 0, 0x10, 0x27, 0, 0, 0, 0, 0, 0}
		if string(got) != string(want) {
			t.Fatalf("ref %d: %x want %x", ref, got, want)
		}
	}
}
