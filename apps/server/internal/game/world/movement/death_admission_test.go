package movement

import (
	"testing"

	"opensro.online/server/internal/game/world/simulation"
)

func TestMoveAdmittedBeforeDeathCannotCommitAfterRevival(t *testing.T) {
	c := testCharacter()
	rt := testRuntime(c)
	key := simulation.WorldKey("0", c.Name)
	start := simulation.EuropeStartProfile()
	// Deterministically interleave the action lane after move admission but
	// before geometry/commit. Alive-at-commit alone used to accept this request.
	rt.ClearCombatIntent = func(string, string) {
		rt.deps.Update(c, "fixture-death-rebirth", func() bool {
			state := rt.Worlds.Update(key, func() simulation.WorldState { return simulation.SeedWorldState(c) }, func(w *simulation.WorldState) {
				w.SettleDeath(testStartMs)
				w.Spawn.X += 25
				w.LifeRevision++
			})
			writeBackWorld(c, state)
			return true
		})
	}
	result := rt.HandleMove("0", c, encodeMoveBody(1, start.RegionID, int16(start.X)+200, int16(start.Y), int16(start.Z)))
	if result.Refusal == nil || result.Refusal.Reason != "characterLifeChanged" || result.Result != nil {
		t.Fatalf("old life move committed: %+v", result)
	}
	for _, f := range result.Frames {
		if f.Opcode == simulation.OpMovementAck {
			t.Fatal("rejected move published movement")
		}
	}
	if result.Authority.MoveSegment != nil || result.Authority.Spawn.X != start.X+25 {
		t.Fatalf("revival placement overwritten: %+v", result.Authority)
	}
	rt.ClearCombatIntent = nil
	if fresh := rt.HandleMove("0", c, encodeMoveBody(1, start.RegionID, int16(start.X)+50, int16(start.Y), int16(start.Z))); fresh.Refusal != nil {
		t.Fatalf("new life request refused: %+v", fresh)
	}
}

func TestAcceptedMovementPublicationRetiresOnDeath(t *testing.T) {
	c := testCharacter()
	rt := testRuntime(c)
	start := simulation.EuropeStartProfile()
	out := rt.HandleMove("0", c, encodeMoveBody(1, start.RegionID, int16(start.X)+200, int16(start.Y), int16(start.Z)))
	if out.Refusal != nil || len(out.Frames) != 1 || out.Frames[0].Current == nil || !out.Frames[0].Current() {
		t.Fatalf("missing movement publication admission: %+v", out)
	}
	key := simulation.WorldKey("0", c.Name)
	rt.Worlds.Update(key, func() simulation.WorldState { panic("missing world") }, func(w *simulation.WorldState) { w.SettleDeath(testStartMs + 500) })
	if out.Frames[0].Current() {
		t.Fatal("accepted pre-death receipt remained publishable")
	}
}
