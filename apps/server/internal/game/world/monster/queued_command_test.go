package monster

import (
	"encoding/binary"
	"testing"
)

func TestQueuedCommandWireDomains(t *testing.T) {
	for _, kind := range []AICommandKind{AICommandBattle, AICommandFlee, AICommandRefreshMonsters} {
		size := 8
		if kind == AICommandRefreshMonsters {
			size = 4
		}
		payload := make([]byte, size)
		binary.LittleEndian.PutUint32(payload, 0xfedcba98)
		if size == 8 {
			binary.LittleEndian.PutUint32(payload[4:], 0xffffffff)
		}
		got, err := DecodeAICommand(kind, payload)
		if err != nil || got.Kind != kind || got.TargetGID != 0xfedcba98 || (size == 8 && got.Duration != 0xffffffff) {
			t.Fatalf("kind=%d command=%+v error=%v", kind, got, err)
		}
		payload[0] = 0
		if got.TargetGID != 0xfedcba98 {
			t.Fatal("payload aliases caller memory")
		}
		for length := 0; length <= 15; length++ {
			if length == size {
				continue
			}
			if _, err := DecodeAICommand(kind, make([]byte, length)); err == nil {
				t.Fatalf("kind=%d accepted length=%d", kind, length)
			}
		}
	}
	if _, err := DecodeAICommand(5, nil); err == nil {
		t.Fatal("accepted an unrecognized internal command")
	}
}

func TestQueuedCommandKindsShareOneReplacementSlot(t *testing.T) {
	for previous := AICommandHelp; previous <= AICommandRefreshMonsters; previous++ {
		for replacement := AICommandHelp; replacement <= AICommandRefreshMonsters; replacement++ {
			first := AICommand{Kind: previous, TargetGID: 10}
			second := AICommand{Kind: replacement, TargetGID: 20}
			box := (CommandInbox{}).ReplaceCommand(first)
			old := box
			box = box.ReplaceCommand(second)
			got, pending := box.PendingCommand()
			if !pending || got != second || old == box {
				t.Fatal("replacement lost command identity")
			}
			if duplicate := box.ReplaceCommand(second); duplicate == box {
				t.Fatal("identical replacement lost admission generation")
			}
			box = box.Consumed()
			if got, pending := box.PendingCommand(); pending || got != (AICommand{}) || box.HasPending() {
				t.Fatal("consumption exposed previous command")
			}
		}
	}
	box := (CommandInbox{}).Replace(HelpEvent{TargetGID: 123})
	box = box.ReplaceCommand(AICommand{Kind: AICommandFlee, TargetGID: 456})
	if _, pending := box.Pending(); pending {
		t.Fatal("help ingress shadowed the later FLEE command")
	}
	if !box.HasPending() {
		t.Fatal("scheduler lost non-help command")
	}
}

func TestNativeStateDurationUnsignedBoundary(t *testing.T) {
	for _, start := range []uint32{0, 1000, 0xfffffff0, 0xffffffff} {
		for _, duration := range []uint32{1, 100, 0x7fffffff, 0xfffffffe} {
			if NativeStateDurationExpired(start, duration, start+duration) {
				t.Fatal("expiry admitted equality")
			}
			if !NativeStateDurationExpired(start, duration, start+duration+1) {
				t.Fatal("expiry lost unsigned wrap")
			}
		}
		if NativeStateDurationExpired(start, 0, start-1) || NativeStateDurationExpired(start, 0xffffffff, start-1) {
			t.Fatal("disabled or maximal duration expired")
		}
	}
}
