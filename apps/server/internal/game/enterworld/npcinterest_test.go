package enterworld

import (
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

func TestNpcBootstrapRecordsExactlyVisibleObjects(t *testing.T) {
	npc := simulation.NpcDef{ObjectID: 200001, RefObjID: 7524, AuthoredSpawn: true, Spawn: simulation.Spawn{RegionID: 25163, X: 958, Y: -155, Z: 99}}
	config := NpcSpawnConfig{Enabled: true, Roster: []simulation.NpcDef{npc}}
	entry := &LocalPlayerEntry{StartProfile: StartProfile{RegionID: 25163, X: 1100, Z: 99}}
	rows := config.NpcObjectListRows(entry)
	if len(rows) != 1 || len(rows[0].Scope) != 1 || rows[0].Scope[0].GID != npc.ObjectID || !rows[0].Scope[0].Visible {
		t.Fatalf("bootstrap did not seed publication: %+v", rows)
	}
	viewer := simulation.SessionSnapshot{NpcsEnabled: true, PublishedObjects: []uint32{npc.ObjectID}, World: simulation.WorldState{Spawn: simulation.Spawn{RegionID: 25163, X: 1100, Z: 99}}}
	if len(simulation.NpcScopeFrames(config.Roster, viewer, 1)) != 0 {
		t.Fatal("first tick duplicates bootstrap")
	}
	entry.StartProfile.X = 0
	if len(config.NpcObjectListRows(entry)) != 0 {
		t.Fatal("same-region but outside message blocks must not bootstrap")
	}
	viewer.World.Spawn.X = 0
	if len(simulation.NpcScopeFrames(config.Roster, viewer, 2)) != 1 {
		t.Fatal("loading-time travel must reconcile bootstrap")
	}
}
