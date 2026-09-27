package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"sync"
	"testing"
	"time"
)

func TestHiveCapConcurrentWorldUpdatesAndObservation(t *testing.T) {
	refs := map[uint32]monster.MonsterRef{1: {TidWord: 0x00C6, RefObjID: 1, MaxHP: 100, MonsterType: 3, ScaleDenom: 100}}
	var nests []monster.NestRow
	for _, region := range []uint16{0x62aa, 0x62ab} {
		nests = append(nests, monster.NestRow{SpawnPoint: monster.SpawnPoint{RefObjID: 1, RegionID: region}, PolicyPinned: true, MaxCount: 3, HiveKey: "shared", HiveMaxCount: 1, Respawn: true, RespawnDelayMinSec: 10, RespawnDelayMaxSec: 10})
	}
	s := NewMonsterState(monster.TemplateFromParts(refs, nests))
	now := time.Unix(100, 0)
	s.SetTimeSource(func() time.Time { return now })
	run := func(update bool) {
		var wg sync.WaitGroup
		for _, division := range []string{"a", "b"} {
			for worker := 0; worker < 8; worker++ {
				wg.Add(1)
				go func(division string) {
					defer wg.Done()
					for i := 0; i < 16; i++ {
						if update {
							s.StartDivision(division)
							s.AdvancePopulation(now.UnixMilli())
						}
						if got := len(s.InstancesInRegions(division, []uint16{0x62ab, 0x62aa})); got > 1 {
							t.Errorf("%s has %d occupants", division, got)
						}
					}
				}(division)
			}
		}
		wg.Wait()
	}
	run(false)
	for _, division := range []string{"a", "b"} {
		if len(s.MaterializedInstances(division)) != 0 {
			t.Fatal("observation spawned a monster")
		}
	}
	run(true)
	for _, division := range []string{"a", "b"} {
		live := s.MaterializedInstances(division)
		if len(live) != 1 || !s.Defeat(division, live[0].Gid, now) {
			t.Fatalf("%s independent occupant/death = %+v", division, live)
		}
	}
	// Change the clock only between joined batches, so the fixture itself is
	// race-free. Queries at the due time must not drive population updates.
	now = now.Add(10 * time.Second)
	run(false)
	for _, division := range []string{"a", "b"} {
		if len(s.MaterializedInstances(division)) != 0 {
			t.Fatal("observation bypassed respawn ownership")
		}
	}
	run(true)
	for _, division := range []string{"a", "b"} {
		if len(s.MaterializedInstances(division)) != 1 {
			t.Fatalf("%s concurrent respawn did not retain one occupant", division)
		}
	}
}

func TestHiveCapSurvivesSectorCrossingAndIsDivisionLocal(t *testing.T) {
	refs := map[uint32]monster.MonsterRef{1: {TidWord: 0x00C6, RefObjID: 1, MaxHP: 100, MonsterType: 3, ScaleDenom: 100}}
	nests := []monster.NestRow{}
	for _, region := range []uint16{0x62aa, 0x62ab} {
		nests = append(nests, monster.NestRow{SpawnPoint: monster.SpawnPoint{RefObjID: 1, RegionID: region}, PolicyPinned: true, MaxCount: 3, HiveKey: "shared", HiveMaxCount: 1, Respawn: true, RespawnDelayMinSec: 10, RespawnDelayMaxSec: 10})
	}
	s := NewMonsterState(monster.TemplateFromParts(refs, nests))
	now := time.Unix(100, 0)
	s.SetTimeSource(func() time.Time { return now })
	s.StartDivision("a")
	s.AdvancePopulation(s.CurrentTimeMillis())
	first := s.InstancesInRegions("a", []uint16{0x62aa})
	if len(first) != 1 {
		t.Fatalf("first sector = %d uniques", len(first))
	}
	for i := 0; i < 3; i++ {
		now = now.Add(time.Second)
		s.StartDivision("a")
		s.AdvancePopulation(s.CurrentTimeMillis())
		s.InstancesInRegions("a", []uint16{0x62ab, 0x62aa})
	}
	if got := len(s.MaterializedInstances("a")); got != 1 {
		t.Fatalf("crossing bypassed cap: %d", got)
	}
	s.StartDivision("b")
	s.AdvancePopulation(s.CurrentTimeMillis())
	if got := len(s.InstancesInRegions("b", []uint16{0x62ab, 0x62aa})); got != 1 {
		t.Fatalf("division shared another world's count: %d", got)
	}
	if !s.Defeat("a", first[0].Gid, now) || s.Defeat("a", first[0].Gid, now) {
		t.Fatal("defeat must release count exactly once")
	}
	now = now.Add(time.Second)
	s.StartDivision("a")
	s.AdvancePopulation(s.CurrentTimeMillis())
	s.InstancesInRegions("a", []uint16{0x62aa, 0x62ab})
	if got := len(s.MaterializedInstances("a")); got != 0 {
		t.Fatalf("neighbor bypassed hive respawn delay: %d", got)
	}
	now = now.Add(9 * time.Second)
	s.StartDivision("a")
	s.AdvancePopulation(s.CurrentTimeMillis())
	s.InstancesInRegions("a", []uint16{0x62aa, 0x62ab})
	if got := len(s.MaterializedInstances("a")); got != 1 {
		t.Fatalf("released cap did not admit one waiting nest: %d", got)
	}
}
