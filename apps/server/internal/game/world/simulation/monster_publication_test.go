package simulation

import (
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestMonsterScopeUsesPublishedSceneNotConstructedBootstrap(t *testing.T) {
	ops, region, _ := scopeStreamFixture(t)
	session := viewerSessionAt(region, 100)
	var constructed []uint32
	ops.Monsters.StartDivision(monsterTestDivision)
	ops.Monsters.AdvancePopulation(ops.Monsters.CurrentTimeMillis())
	for _, m := range ops.Monsters.InstancesInRegions(monsterTestDivision, []uint16{region}) {
		constructed = append(constructed, m.Gid)
	}
	ops.Monsters.RecordObjectList(monsterTestDivision, PlayerObjectID(session.CharacterID), constructed)
	// Bootstrap construction is not publication. An empty transport snapshot
	// must produce creates even if a failed/replaced build recorded these GIDs.
	session.PublishedObjects = []uint32{}
	push := &fakePusher{}
	ops.RunMonsterLeg(1_784_000_000_000, []SessionSnapshot{session}, push)
	created := map[uint32]bool{}
	for _, frame := range sessionFrames(push, session.SessionID) {
		if frame.Opcode == wire.OpSingleObjectSpawn {
			if frame.ScopeGID == 0 || !frame.ScopeVisible {
				t.Fatal("create lacks publication identity")
			}
			created[frame.ScopeGID] = true
		}
	}
	if len(created) != len(constructed) {
		t.Fatal("unpublished actors treated as visible", created, constructed)
	}
	for _, gid := range constructed {
		if !created[gid] {
			t.Fatal("missing create", gid)
		}
	}
	frames := MonsterDespawnBracketFrames(constructed)
	if len(frames) != 3 || len(frames[2].Scope) != len(constructed) {
		t.Fatal("bulk removal lost scope transaction")
	}
	for i, change := range frames[2].Scope {
		if change.GID != constructed[i] || change.Visible {
			t.Fatal(change)
		}
	}
}
