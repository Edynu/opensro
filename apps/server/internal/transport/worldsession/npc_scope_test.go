package worldsession

import (
	"opensro.online/server/internal/game/world/simulation"
	"testing"
)

func TestNpcPublicationIsSceneFencedAndAdmitted(t *testing.T) {
	srv := startServer(t)
	c, welcome := dialAndHello(t, srv)
	session, _ := srv.Hub.Session(welcome.SessionID)
	bridge := New(srv.Hub)
	old := SessionSceneID(session)
	npc := simulation.NpcDef{ObjectID: 200001, RefObjID: 7524, AuthoredSpawn: true, Spawn: simulation.Spawn{RegionID: 25163, X: 958, Y: -155, Z: 99}}
	view := simulation.SessionSnapshot{NpcsEnabled: true, PublishedObjects: []uint32{}, World: simulation.WorldState{Spawn: npc.Spawn}}
	frames := simulation.NpcScopeFrames([]simulation.NpcDef{npc}, view, 1)
	session.BeginSceneAdmission()
	session.FinishSceneReentry()
	bridge.PushToSession(old, frames)
	revision, _ := session.SceneRevision()
	shown, _ := session.PublishedObjects(revision)
	if len(shown) != 0 {
		t.Fatal("old scene published NPC")
	}
	bridge.PushToSession(SessionSceneID(session), frames)
	shown, _ = session.PublishedObjects(revision)
	if len(shown) != 1 || shown[0] != npc.ObjectID {
		t.Fatalf("publication not admitted: %v", shown)
	}
	if f := readFrame(t, c); f.Opcode != 0x30d7 || len(f.Payload) != len(frames[0].Payload) {
		t.Fatal("NPC single-create wire")
	}
	view.PublishedObjects = shown
	if len(simulation.NpcScopeFrames([]simulation.NpcDef{npc}, view, 2)) != 0 {
		t.Fatal("duplicate admitted create")
	}
	view.World.Spawn.X = 0
	bridge.PushToSession(SessionSceneID(session), simulation.NpcScopeFrames([]simulation.NpcDef{npc}, view, 3))
	if f := readFrame(t, c); f.Opcode != 0x36ab {
		t.Fatal("NPC departure wire")
	}
	shown, _ = session.PublishedObjects(revision)
	if len(shown) != 0 {
		t.Fatal("departure retained publication")
	}
}
