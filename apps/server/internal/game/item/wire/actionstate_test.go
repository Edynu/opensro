package wire

import (
	"bytes"
	"errors"
	"testing"
)

func TestActionStateEncodesTwoByteForms(t *testing.T) {
	if got := ReleaseActionState().Encode(); !bytes.Equal(got, []byte{0x02, 0x00}) {
		t.Fatalf("release = % X, want 02 00", got)
	}
	if got := ArmActionState().Encode(); !bytes.Equal(got, []byte{0x01, 0x01}) {
		t.Fatalf("arm = % X, want 01 01", got)
	}
}

func TestActionStateNoticeCarriesTheErrorByte(t *testing.T) {
	notice := ActionState{Kind: ActionStateKindNotice, State: 0, ErrorCode: 0x39}
	got := notice.Encode()
	if !bytes.Equal(got, []byte{0x03, 0x00, 0x39}) {
		t.Fatalf("notice = % X, want 03 00 39", got)
	}

	decoded, err := DecodeActionState(got)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if decoded != notice {
		t.Fatalf("round trip = %+v, want %+v", decoded, notice)
	}
}

func TestActionStateDecodeRejectsWrongLengths(t *testing.T) {
	// The two-byte kinds must not carry a third byte.
	if _, err := DecodeActionState([]byte{0x02, 0x00, 0x00}); !errors.Is(err, ErrTrailingBytes) {
		t.Fatalf("trailing byte on a release = %v, want ErrTrailingBytes", err)
	}
	// The notice form requires its error byte.
	if _, err := DecodeActionState([]byte{0x03, 0x00}); !errors.Is(err, ErrShortPayload) {
		t.Fatalf("truncated notice = %v, want ErrShortPayload", err)
	}
	if _, err := DecodeActionState([]byte{0x01}); !errors.Is(err, ErrShortPayload) {
		t.Fatalf("one-byte payload = %v, want ErrShortPayload", err)
	}
}

func TestActionStateRoundTrip(t *testing.T) {
	for _, state := range []ActionState{
		ReleaseActionState(),
		ArmActionState(),
		{Kind: ActionStateKindNotice, State: 1, ErrorCode: 0x07},
	} {
		decoded, err := DecodeActionState(state.Encode())
		if err != nil {
			t.Fatalf("round trip of %+v failed: %v", state, err)
		}
		if decoded != state {
			t.Fatalf("round trip = %+v, want %+v", decoded, state)
		}
	}
}
