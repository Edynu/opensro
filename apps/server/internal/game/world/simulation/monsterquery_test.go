package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"testing"
	"time"
)

func TestMonsterQueryDoesNotCreateOrAdvancePopulation(t *testing.T) {
	s := NewMonsterState(monster.TemplateFromParts(map[uint32]monster.MonsterRef{1: {TidWord: 0x00C6, RefObjID: 1, MaxHP: 100, MonsterType: 3}}, []monster.NestRow{{SpawnPoint: monster.SpawnPoint{RefObjID: 1, RegionID: 257, X: 12, Z: 34}, MaxCount: 1, PolicyPinned: true, Respawn: true, RespawnDelayMinSec: 1, RespawnDelayMaxSec: 1}}))
	now := time.Unix(100, 0)
	s.SetTimeSource(func() time.Time { return now })
	if len(s.InstancesInRegions("a", []uint16{257})) != 0 || len(s.MaterializedInstances("a")) != 0 || len(s.divs) != 0 {
		t.Fatal("population observation allocated a world")
	}
	if len(s.QueryMonsterPositions("a", 1)) != 0 || len(s.divs) != 0 {
		t.Fatal("query materialized division")
	}
	s.StartDivision("a")
	s.AdvancePopulation(s.CurrentTimeMillis())
	first := s.InstancesInRegions("a", []uint16{257})[0]
	rows := s.QueryMonsterPositions("a", 1)
	if len(rows) != 1 || rows[0].GID != first.Gid || rows[0].Pose.X != 12 || rows[0].Pose.Z != 34 {
		t.Fatalf("wrong position: %+v", rows)
	}
	if len(s.DrainUniqueNotices("a")) != 1 {
		t.Fatal("query consumed announcement")
	}
	if len(s.QueryMonsterPositions("a", 2)) != 0 {
		t.Fatal("reference filter ignored")
	}
	s.Defeat("a", first.Gid, now)
	now = now.Add(time.Minute)
	if len(s.QueryMonsterPositions("a", 1)) != 0 || len(s.MaterializedInstances("a")) != 0 {
		t.Fatal("query advanced respawn")
	}
	if len(s.InstancesInRegions("a", []uint16{257})) != 0 {
		t.Fatal("regional observation advanced respawn")
	}
	s.AdvancePopulation(now.UnixMilli())
	if len(s.InstancesInRegions("a", []uint16{257})) != 1 {
		t.Fatal("explicit population clock did not respawn")
	}
}
