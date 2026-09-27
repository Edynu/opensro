package transport

import "testing"

func TestBootstrapPublicationSnapshotOwnsSceneLifetime(t *testing.T) {
	hub := newHub(testCfg())
	s, err := hub.createSession()
	if err != nil {
		t.Fatal(err)
	}
	defer hub.closeSession(s, nil)
	old, _ := s.SceneRevision()
	frames := []Frame{{Opcode: 0x3417, Scope: []ObjectScopeChange{{GID: 400001, Visible: true}}}, {Opcode: 0x330a}}
	if err := s.SendSceneReset(frames); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.PublishedObjects(old); ok {
		t.Fatal("old scene adopted bootstrap")
	}
	if !s.FinishSceneReentry() {
		t.Fatal("scene did not finish")
	}
	revision, _ := s.SceneRevision()
	gids, ok := s.PublishedObjects(revision)
	if !ok || len(gids) != 1 || gids[0] != 400001 {
		t.Fatal(gids, ok)
	}
	gids[0] = 999
	frames[0].Scope[0].GID = 999
	gids, _ = s.PublishedObjects(revision)
	if gids[0] != 400001 {
		t.Fatal("publication leaked mutable metadata")
	}
	if err := s.SendSceneBatch(revision, []Frame{{Opcode: 0x330a, Scope: []ObjectScopeChange{{GID: 400001}}}}); err != nil {
		t.Fatal(err)
	}
	gids, ok = s.PublishedObjects(revision)
	if !ok || gids == nil || len(gids) != 0 {
		t.Fatal("empty publication is not an absent snapshot", gids, ok)
	}
	s.BeginSceneAdmission()
	if _, ok := s.PublishedObjects(revision); ok {
		t.Fatal("retired snapshot remained current")
	}
}
