package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"os"
	"testing"
)

func TestMonsterArchiveExactRoundTripAndReusesSlots(t *testing.T) {
	owner := NewMonsterState(monster.Template{})
	if err := owner.EnableDormantStorage(); err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	name := owner.archive.file.Name()
	s := newMonsterStorage(nil)
	s.archive = owner.archive
	actor := monster.Instance{Gid: 42, Ref: monster.MonsterRef{RefObjID: 123, Name: "preserved monster", MaxHP: 99, BodyRadius: 8}, Nest: lifecycleNest(151.123456789), Spawn: monster.SpawnPoint{RegionID: lifecycleRegion, X: 153.987654321, Y: -1.25, Z: 615.456789123}, CurrentHP: 99, SpawnHeading: 61234}
	for i := 0; i < 100; i++ {
		s.set(actor.Gid, actor)
		s.freeze(actor.Gid)
		if len(s.hot) != 0 || len(s.cold) != 1 || s.len() != 1 {
			t.Fatal("archive retained live actor data")
		}
		if got, ok := s.lookup(actor.Gid); !ok || got != actor {
			t.Fatal("archive changed actor identity, values or position")
		}
		if len(s.hot) != 0 {
			t.Fatal("read-only query woke actor")
		}
		s.wake(actor.Gid)
		if s.get(actor.Gid) != actor || len(s.cold) != 0 {
			t.Fatal("wake changed actor")
		}
	}
	if owner.archive.next != monsterArchiveSlotBytes {
		t.Fatal("repeated boundary crossings grew backing file")
	}
	s.freeze(actor.Gid)
	s.remove(actor.Gid)
	if s.contains(actor.Gid) || s.len() != 0 {
		t.Fatal("removed actor survived in backing index")
	}
	unique := actor
	unique.Ref.MonsterType = 3
	s.set(unique.Gid, unique)
	s.freeze(unique.Gid)
	if len(s.cold) != 0 {
		t.Fatal("unique was archived")
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("backing file not removed")
	}
}
