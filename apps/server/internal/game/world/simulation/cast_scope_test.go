package simulation

import (
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestCastControlUsesCurrentSourceScope(t *testing.T) {
	a := peerSession("a", "A", 1, "A")
	b := peerSession("b", "A", 2, "B")
	foreign := peerSession("c", "A", 3, "C")
	a.WorldInstance, b.WorldInstance, foreign.WorldInstance = 0x10001, 0x10001, 0x20001
	source := &fakeSource{sessions: []SessionSnapshot{a, b, foreign}}
	push := &fakePusher{}
	ticker := newTestTicker(source, push)
	ticker.Hooks = []TickHook{func(int64) []DivisionFrames {
		return []DivisionFrames{{DivisionID: "A", SourceGID: PlayerObjectID(1), Frames: []Frame{{Opcode: wire.OpSkillEffectControl}}}}
	}}
	ticker.RunTick(100)
	if len(peerFramesTo(push, "a", wire.OpSkillEffectControl)) != 1 || len(peerFramesTo(push, "b", wire.OpSkillEffectControl)) != 1 || len(peerFramesTo(push, "c", wire.OpSkillEffectControl)) != 0 || len(push.toDivision) != 0 {
		t.Fatal("cast scope leaked or omitted source")
	}
	push.toSession = nil
	source.sessions[1].World.Spawn.X += 2000
	ticker.RunTick(200)
	if len(peerFramesTo(push, "b", wire.OpObjectDespawn)) != 1 || len(peerFramesTo(push, "b", wire.OpSkillEffectControl)) != 0 {
		t.Fatal("departed observer received cast control")
	}
	push.toSession = nil
	source.sessions[1].World.Spawn = b.World.Spawn
	ticker.RunTick(300)
	if len(peerFramesTo(push, "b", wire.OpSingleObjectSpawn)) != 1 || len(peerFramesTo(push, "b", wire.OpSkillEffectControl)) != 1 {
		t.Fatal("reentry did not restore current scope")
	}
}
