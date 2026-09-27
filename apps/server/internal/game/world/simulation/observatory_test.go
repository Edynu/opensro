package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"testing"
	"time"
)

func TestObservatoryDoesNotDriveWorldLifecycle(t *testing.T) {
	s := NewMonsterState(monster.TemplateFromParts(map[uint32]monster.MonsterRef{1: {TidWord: 0x00C6, RefObjID: 1, Name: "Unique", MaxHP: 100, MonsterType: 3}}, []monster.NestRow{{SpawnPoint: monster.SpawnPoint{RefObjID: 1, RegionID: 257, X: 12, Z: 34}, MaxCount: 1, PolicyPinned: true, Respawn: true, RespawnDelayMinSec: 1, RespawnDelayMaxSec: 1}}))
	now := time.Unix(100, 0)
	s.SetTimeSource(func() time.Time { return now })
	if snap := s.Observatory("a"); snap.Resident != 0 || len(s.divs) != 0 {
		t.Fatal("observation created population")
	}
	s.StartDivision("a")
	s.AdvancePopulation(s.CurrentTimeMillis())
	first := s.InstancesInRegions("a", []uint16{257})[0]
	snap := s.Observatory("a")
	if snap.Resident != 1 || len(snap.Monsters) != 1 || snap.Monsters[0].GID != first.Gid || snap.Monsters[0].Rarity != 3 {
		t.Fatalf("wrong snapshot: %+v", snap)
	}
	snap.Monsters[0].HP = 0
	if s.Observatory("a").Monsters[0].HP == 0 {
		t.Fatal("snapshot aliases authority")
	}
	if len(s.DrainUniqueNotices("a")) != 1 {
		t.Fatal("capture consumed notice")
	}
	s.Defeat("a", first.Gid, now)
	now = now.Add(time.Minute)
	if s.Observatory("a").Resident != 0 {
		t.Fatal("capture advanced respawn")
	}
}
