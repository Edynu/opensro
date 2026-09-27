package action

import (
	"fmt"
	"math"
	"testing"
	"time"

	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

// A goal-count assertion misses the original failure: valid tiny B738 legs
// repeat forever until the target stops. Require B245 while it is still moving,
// using the production tick period and the real authority/range/cast owners.
func TestPursuitAttacksBeforeWalkingTargetStops(t *testing.T) {
	for _, speed := range []float64{6, 8, 12, 16} {
		for _, degrees := range []float64{0, 45, 90, 135, 180, 225, 270, 315} {
			t.Run(fmt.Sprintf("speed-%g-bearing-%g", speed, degrees), func(t *testing.T) {
				dx, dz := math.Cos(degrees*math.Pi/180), math.Sin(degrees*math.Pi/180)
				rt, clock, character, target := newCombatTestRuntime(t, 100)
				mover, _ := rt.Monsters.Mover(testDivision, target.Gid)
				*character.World.Spawn.X = mover.Pose.X - 50*dx
				*character.World.Spawn.Z = mover.Pose.Z - 50*dz
				mover.From = mover.Pose
				mover.To = mover.Pose
				mover.To.X += speed * 20 * dx
				mover.To.Z += speed * 20 * dz
				mover.DepartMs = clock.NowMs()
				mover.ArriveMs = mover.DepartMs + 20000
				if !rt.Monsters.CommitMover(testDivision, target.Gid, mover) {
					t.Fatal("target fixture")
				}
				rt.HandleTargetInteract(testDivision, character, wire.BasicAttackEngage{TargetGid: target.Gid}.Encode())
				for elapsed := time.Duration(0); elapsed < 10*time.Second; elapsed += simulation.DefaultTickInterval {
					clock.Advance(simulation.DefaultTickInterval)
					for _, route := range rt.TickHook()(clock.NowMs()) {
						for _, frame := range route.Frames {
							if frame.Opcode == 0xb245 {
								return
							}
						}
					}
				}
				t.Fatal("player kept tailing a walking target for 10 seconds without attacking")
			})
		}
	}
}
