package simulation

import (
	"testing"

	"opensro.online/server/internal/game/world/monster"
)

// A fatal result retains the instance briefly for the native death/corpse
// presentation. That retained row is presentation state, never a license for
// the authoritative mover to finish an old wander or chase leg.
func TestPresentationRetainedDeadMonsterCannotAdvanceMover(t *testing.T) {
	const t0 = int64(1_784_000_000_000)
	ops, instance := monsterLegFixture(t, passiveTactics())
	mover, ok := ops.Monsters.Mover(monsterTestDivision, instance.Gid)
	if !ok {
		t.Fatal("missing mover")
	}
	mover.From = mover.Pose
	mover.To = monster.Pose{
		RegionID: mover.Pose.RegionID,
		X:        mover.Pose.X + 30, Y: mover.Pose.Y, Z: mover.Pose.Z,
	}
	mover.DepartMs = t0
	mover.ArriveMs = t0 + 1_000
	if !ops.Monsters.CommitMover(monsterTestDivision, instance.Gid, mover) {
		t.Fatal("failed to commit in-flight corpse fixture")
	}
	if damage, applied := ops.Monsters.ApplyDamage(monsterTestDivision, instance.Gid, instance.CurrentHP); !applied || !damage.Fatal {
		t.Fatalf("fatal fixture damage = %+v applied=%v", damage, applied)
	}
	dead, ok := ops.Monsters.Get(monsterTestDivision, instance.Gid)
	if !ok || dead.CurrentHP != 0 {
		t.Fatalf("dead presentation row = %+v ok=%v", dead, ok)
	}
	before, _ := ops.Monsters.Mover(monsterTestDivision, instance.Gid)
	if frames, _ := ops.advanceInstance(monsterTestDivision, dead, nil, t0+2_000); len(frames) != 0 {
		t.Fatalf("dead retained monster emitted mover frames: %+v", frames)
	}
	after, _ := ops.Monsters.Mover(monsterTestDivision, instance.Gid)
	if after != before {
		t.Fatalf("dead retained monster mutated mover:\nbefore %+v\nafter  %+v", before, after)
	}
}
