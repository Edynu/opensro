package wire

import "testing"

func TestProgressionProjectionDoesNotDuplicatePublicFlagsOrLoseAdmission(t *testing.T) {
	current := true
	frames := []Frame{{Opcode: OpLevelUpEffect}, {Opcode: OpVisualFlagsUpdate, Payload: []byte{1}, Current: func() bool { return current }}, {Opcode: OpExpUpdate, Payload: []byte{2}, Current: func() bool { return current }}}
	public, private := ProgressionBroadcastFrames(frames), ProgressionPrivateFrames(frames)
	if len(public) != 2 || len(private) != 1 || private[0].Opcode != OpExpUpdate {
		t.Fatalf("duplicate or leaked projection: %v %v", public, private)
	}
	current = false
	if public[1].Current == nil || private[0].Current == nil || public[1].Current() || private[0].Current() {
		t.Fatal("stale delivery guard lost")
	}
	frames[1].Payload[0] = 3
	frames[2].Payload[0] = 4
	if public[1].Payload[0] != 1 || private[0].Payload[0] != 2 {
		t.Fatal("projection aliases source")
	}
}
