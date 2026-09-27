package simulation

import (
	"encoding/json"
	"testing"
)

func TestDeathSettlementPreservesRegionHeightAndFacing(t *testing.T) {
	for _, row := range []struct {
		name           string
		from, to, want Spawn
	}{
		{"sector-boundary", Spawn{RegionID: 0x6046, X: 1910, Y: 1124, Z: 610}, Spawn{RegionID: 0x6047, X: 30, Y: 1126, Z: 670, Angle: 43210}, Spawn{RegionID: 0x6047, X: 10, Y: 1125, Z: 640, Angle: 43210}},
		{"dungeon", Spawn{RegionID: 0x8001, X: -100, Y: 12, Z: -300}, Spawn{RegionID: 0x8001, X: 100, Y: 22, Z: -100, Angle: 12345}, Spawn{RegionID: 0x8001, X: 0, Y: 17, Z: -200, Angle: 12345}},
	} {
		t.Run(row.name, func(t *testing.T) {
			w := WorldState{Spawn: row.to, MoveSegment: &MoveSegment{From: row.from, StartedAtMs: 100, ArrivesAtMs: 1100}, MovementMode: WalkMode, Sitting: true, PostureTransitionUntilMs: 2000}
			w.SettleDeath(600)
			if w.Spawn != row.want || w.MoveSegment != nil || w.Sitting || w.PostureTransitionUntilMs != 0 || w.MovementMode != WalkMode {
				t.Fatalf("death settlement %+v, want %+v", w, row.want)
			}
			w.UpdateMovementSpeeds(40, 100, 10000)
			if w.LiveSpawnAt(100000) != row.want {
				t.Fatal("effect speed transition restarted corpse")
			}
		})
	}
}

func TestMovementDeliveryMetadataNeverEntersJSON(t *testing.T) {
	value := SessionSnapshot{MovementCurrent: func() bool { return true }}
	if _, err := json.Marshal(value); err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(Frame{Current: func() bool { return true }}); err != nil {
		t.Fatal(err)
	}
}
