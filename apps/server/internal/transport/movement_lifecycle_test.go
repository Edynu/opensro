package transport

import (
	"sync/atomic"
	"testing"
)

func TestQueuedMovementCannotCrossDeathAndRebirth(t *testing.T) {
	_, s, conn := attachedSession(t, true)
	var life atomic.Uint64
	oldLife := life.Load()
	old := Frame{Opcode: 0xb738, Payload: []byte{7}, Current: func() bool { return life.Load() == oldLife }}
	if err := s.SendBatch([]Frame{old}); err != nil {
		t.Fatal(err)
	}
	life.Add(1)
	if err := s.SendBatch([]Frame{{Opcode: 0x3122, Payload: []byte{7, 0, 0, 0, 0, 2}}, {Opcode: 0xb2f5, Payload: []byte{7}}, {Opcode: 0x3122, Payload: []byte{7, 0, 0, 0, 0, 1}}}); err != nil {
		t.Fatal(err)
	}
	// Deliberately publish the stale tick result AFTER the revival batch.
	if err := s.SendBatch([]Frame{old, {Opcode: 0x7000}}); err != nil {
		t.Fatal(err)
	}
	conn.openGate()
	frames := waitWritten(t, conn, 5) // WELCOME, death, correction, alive, sentinel
	if len(frames) != 5 {
		t.Fatalf("unexpected queued frames: %+v", frames)
	}
	for _, f := range frames {
		if f.Opcode == 0xb738 {
			t.Fatal("retired movement reached the connection")
		}
	}
}

func TestCurrentMovementKeepsReliableOrdering(t *testing.T) {
	_, s, conn := attachedSession(t, true)
	if err := s.SendBatch([]Frame{{Opcode: 0xb738, Current: func() bool { return true }}, {Opcode: 0x3122, Payload: []byte{7, 0, 0, 0, 0, 2}}}); err != nil {
		t.Fatal(err)
	}
	conn.openGate()
	frames := waitWritten(t, conn, 3)
	if frames[1].Opcode != 0xb738 || frames[2].Opcode != 0x3122 {
		t.Fatalf("movement/life order: %+v", frames)
	}
}
