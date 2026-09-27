package wire

import (
	"bytes"
	"os"
	"testing"
)

func TestWindows1252AgainstNativeCodeUnitCapture(t *testing.T) {
	oracle, err := os.ReadFile("testdata/windows1252.bin")
	if err != nil {
		t.Fatal(err)
	}
	if len(oracle) != 65536 {
		t.Fatal("incomplete native capture")
	}
	for r := rune(0); r <= 0xffff; r++ {
		if r >= 0xd800 && r <= 0xdfff {
			continue
		} // not representable as a Go Unicode scalar
		got := EncodeWindows1252(string(r))
		if len(got) != 1 || got[0] != oracle[r] {
			t.Fatalf("U+%04X: %x want %02x", r, got, oracle[r])
		}
	}
}

func TestWindows1252AuthoredText(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want []byte
	}{
		{"Caf\u00e9 \u20ac", []byte{'C', 'a', 'f', 0xe9, ' ', 0x80}},
		{"\u0100\u2013\u2026", []byte{'A', 0x96, 0x85}},
		{"\u6f22\U0001f600", []byte{'?', '?', '?'}},
	} {
		if got := EncodeWindows1252(tc.in); !bytes.Equal(got, tc.want) {
			t.Fatalf("%q: %x want %x", tc.in, got, tc.want)
		}
	}
}

func TestWindows1252DecodeRoundTripAllBytes(t *testing.T) {
	for b := 0; b < 256; b++ {
		input := []byte{byte(b)}
		if got := EncodeWindows1252(DecodeWindows1252(input)); !bytes.Equal(got, input) {
			t.Fatalf("byte %02x became %x", b, got)
		}
	}
	if got := DecodeWindows1252([]byte{0x43, 0x61, 0x66, 0xe9, 0x20, 0x80}); got != "Caf\u00e9 \u20ac" {
		t.Fatalf("decode: %q", got)
	}
}
