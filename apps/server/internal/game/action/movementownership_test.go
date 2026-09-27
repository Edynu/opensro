package action

import (
	"encoding/binary"
	"math"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/statuseffect"
	"opensro.online/server/internal/game/item/wire"
)

func TestMovementOwnershipPublishesRestoredSources(t *testing.T) {
	rt, clock, c, _ := newCombatTestRuntime(t, 100000)
	check := func(frames []wire.Frame, want float32) {
		t.Helper()
		walk, run := rt.EntryMovementSpeeds(testDivision, c.Name)
		if math.Abs(float64(run-want)) > 0.0001 || math.Abs(float64(walk-want*0.4)) > 0.0001 {
			t.Fatalf("world speeds %v/%v want run %v", walk, run, want)
		}
		found := false
		for _, f := range frames {
			if f.Opcode != 0x376f {
				continue
			}
			found = true
			if len(f.Payload) != 12 || binary.LittleEndian.Uint32(f.Payload) != enterworld.ObjectIDForCharacter(c) || math.Float32frombits(binary.LittleEndian.Uint32(f.Payload[4:])) != walk || math.Float32frombits(binary.LittleEndian.Uint32(f.Payload[8:])) != run {
				t.Fatal("wire/world disagreement", f)
			}
		}
		if !found {
			t.Fatal("missing speed publication")
		}
	}
	for i, kind := range []statuseffect.MovementKind{statuseffect.MovementHaste, statuseffect.MovementOverride, statuseffect.MovementIndependent} {
		row := enterworld.SkillRow{ID: uint32(100 + i), Group: uint32(100 + i), EffectDurationMs: 100000,
			MovementModifier: enterworld.SkillMovementModifier{Present: true, Supported: true, Kind: kind, Percent: []uint32{20, 40, 50}[i]}}
		frames, ok := rt.commitCharacterEffect(testDivision, c, row, uint32(100+i), statuseffect.StateActive, true, EffectPresentation{Phase: 2}, clock.NowMs())
		if !ok {
			t.Fatal("install")
		}
		check(frames, []float32{60, 70, 105}[i])
	}
	for i, token := range []uint32{101, 102, 100} {
		if _, ok := rt.effects.RequestVoluntaryStop(testDivision, c.Name, token, token); !ok {
			t.Fatal("stop")
		}
		var frames []wire.Frame
		for _, batch := range rt.drainStoppedCharacterEffects() {
			for _, f := range batch.Frames {
				frames = append(frames, wire.Frame{Opcode: f.Opcode, Payload: f.Payload})
			}
		}
		check(frames, []float32{90, 60, 50}[i])
	}
}
