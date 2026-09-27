package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"testing"
	"time"
)

func TestKnockbackHoldsMoverAndPublishesCurrentSpawnMotion(t *testing.T) {
	registry := damageTestState()
	now := int64(1000)
	registry.clock = func() time.Time { return time.UnixMilli(now) }
	instance := firstDamageTestMonster(t, registry, "damage")
	stale, _ := registry.Mover("damage", instance.Gid)
	pose := monster.Pose{RegionID: instance.Spawn.RegionID, X: 120, Y: 20, Z: 100}
	results := registry.ApplyDamageSequence("damage", instance.Gid, instance.CurrentHP, []MonsterDamagePlan{{GID: instance.Gid, Damage: 1, Knockback: &MonsterKnockdownPlan{Pose: pose, UntilMs: 3000}}})
	if len(results) != 1 || registry.CommitMover("damage", instance.Gid, stale) {
		t.Fatal("knockback did not supersede the old movement plan")
	}
	current, _ := registry.Mover("damage", instance.Gid)
	if current.Pose != pose || registry.CommitMover("damage", instance.Gid, current) {
		t.Fatal("movement admitted during knockback")
	}
	for _, tc := range []struct {
		at     int64
		motion byte
	}{{2999, 16}, {3000, 0}} {
		now = tc.at
		live, _ := registry.Get("damage", instance.Gid)
		row := BuildMonsterCreateRow(monsterWireDefFromInstance(live, now), instance.Gid, Spawn{RegionID: pose.RegionID, X: pose.X, Y: pose.Y, Z: pose.Z})
		if row[30] != tc.motion {
			t.Fatalf("spawn at %d: motion %d, want %d", now, row[30], tc.motion)
		}
	}
	if registry.CommitMover("damage", instance.Gid, stale) || !registry.CommitMover("damage", instance.Gid, current) {
		t.Fatal("recovery must admit the current mover while rejecting the displaced plan")
	}
}
