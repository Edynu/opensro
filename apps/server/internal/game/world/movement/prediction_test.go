package movement

import (
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

func TestPredictionUsesReceiptWithoutAlsoReplayingNativeMovement(t *testing.T) {
	native := MoveOutcome{Frames: []wire.Frame{{Opcode: simulation.OpMovementAck, Payload: []byte{1}}, {Opcode: 0x30b5, Payload: []byte{2}}}}
	feedback := predictionFeedback(native)
	if len(feedback) != 1 || feedback[0].Opcode != 0x30b5 {
		t.Fatalf("unrelated feedback lost or duplicate movement retained: %+v", feedback)
	}
	if len(native.Frames) != 2 || native.Frames[0].Opcode != simulation.OpMovementAck {
		t.Fatal("native movement response was mutated")
	}
	refused := MoveOutcome{Frames: []wire.Frame{{Opcode: 0xb074, Payload: []byte{2, 1}}}}
	if got := predictionFeedback(refused); len(got) != 1 || got[0].Opcode != 0xb074 {
		t.Fatal("refusal feedback lost")
	}
}
