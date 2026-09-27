package wire

import (
	"bytes"
	"testing"
)

func TestSourceEffectNativeLayout(t *testing.T) {
	e := SourceEffect{SkillID: 7246, InstanceToken: 50, SubjectGID: 8, SubjectName: []byte("Peer")}
	want := []byte{0x4e, 0x1c, 0, 0, 50, 0, 0, 0, 8, 0, 0, 0, 4, 0, 'P', 'e', 'e', 'r'}
	for _, rider := range []bool{false, true} {
		got, err := e.Encode(rider)
		expected := append([]byte(nil), want...)
		if rider {
			expected = append(expected, 0, 0, 0, 0)
		}
		if err != nil || !bytes.Equal(got, expected) {
			t.Fatalf("layout %v: %x, %v", rider, got, err)
		}
	}
	e.Rider = 1000
	if _, err := e.Encode(false); err == nil {
		t.Fatal("unconfigured rider accepted")
	}
	got, err := e.Encode(true)
	if err != nil || !bytes.Equal(got[len(want):], []byte{0xe8, 3, 0, 0}) {
		t.Fatalf("rider: %x %v", got, err)
	}
	e.SubjectName = make([]byte, 65536)
	if _, err := e.Encode(true); err == nil {
		t.Fatal("overflowed native string accepted")
	}
}
