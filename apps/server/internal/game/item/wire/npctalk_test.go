package wire

import (
	"bytes"
	"testing"
)

func TestNpcDialogWireKindsAndStrictChoice(t *testing.T) {
	wantOptions := []byte{
		4, 1, 0, 'Q', 2,
		1, 0, 'A',
		2, 0, 'B', 'C',
	}
	if got := EncodeNpcDialogOptions("Q", []string{"A", "BC"}); !bytes.Equal(got, wantOptions) {
		t.Fatalf("kind-4 = % X, want % X", got, wantOptions)
	}
	if got := EncodeNpcDialogConfirm("Y"); !bytes.Equal(got, []byte{3, 1, 0, 'Y'}) {
		t.Fatalf("kind-3 = % X", got)
	}
	if choice, err := DecodeNpcDialogChoice([]byte{5}); err != nil || choice != 5 {
		t.Fatalf("choice = %d/%v, want 5", choice, err)
	}
	for _, malformed := range [][]byte{{}, {5, 0}} {
		if _, err := DecodeNpcDialogChoice(malformed); err == nil {
			t.Fatalf("malformed % X accepted", malformed)
		}
	}
}
