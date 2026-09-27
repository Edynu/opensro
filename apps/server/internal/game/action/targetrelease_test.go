package action

import (
	"bytes"
	"testing"

	"opensro.online/server/internal/game/item/wire"
)

func TestTargetReleaseClearsMatchingSelectionAndAnswersTalkClose(t *testing.T) {
	character := testCharacter()
	runtime, _ := newTestRuntime(character, testItems())
	const gid uint32 = 200001
	runtime.Selected.Set(testDivision, character.Name, gid)

	outcome := runtime.HandleTargetRelease(
		testDivision,
		character,
		selectBody(gid),
	)
	if outcome.Refusal != "" {
		t.Fatalf("matching release refused: %s", outcome.Refusal)
	}
	if outcome.Released != gid {
		t.Fatalf("released gid = %d, want %d", outcome.Released, gid)
	}
	if _, ok := runtime.Selected.Get(testDivision, character.Name); ok {
		t.Fatal("matching release left the selection recorded")
	}
	assertOpcodes(t, outcome.Frames, wire.OpTalkCloseResult)
	if got := outcome.Frames[0].Payload; !bytes.Equal(got, []byte{1}) {
		t.Fatalf("0xB4B3 body = % X, want mode-1 body 01", got)
	}
}

func TestTargetReleaseRefusalsPreserveSelection(t *testing.T) {
	character := testCharacter()
	runtime, _ := newTestRuntime(character, testItems())
	const selected uint32 = 200001
	runtime.Selected.Set(testDivision, character.Name, selected)

	for _, testCase := range []struct {
		name    string
		payload []byte
	}{
		{name: "malformed", payload: []byte{0x41, 0x0d, 0x03}},
		{name: "different gid", payload: selectBody(selected + 1)},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			outcome := runtime.HandleTargetRelease(
				testDivision,
				character,
				testCase.payload,
			)
			if outcome.Refusal == "" {
				t.Fatal("invalid release was accepted")
			}
			if len(outcome.Frames) != 0 {
				t.Fatalf("refusal emitted frames: %#v", outcome.Frames)
			}
			if gid, ok := runtime.Selected.Get(testDivision, character.Name); !ok || gid != selected {
				t.Fatalf(
					"selection after refusal = %d/%v, want %d preserved",
					gid,
					ok,
					selected,
				)
			}
		})
	}
}

func TestTargetReleaseWithoutSelectionIsSilentRefusal(t *testing.T) {
	character := testCharacter()
	runtime, _ := newTestRuntime(character, testItems())

	outcome := runtime.HandleTargetRelease(
		testDivision,
		character,
		selectBody(200001),
	)
	if outcome.Refusal == "" {
		t.Fatal("release without a current selection was accepted")
	}
	if len(outcome.Frames) != 0 {
		t.Fatalf("release refusal emitted frames: %#v", outcome.Frames)
	}
}
