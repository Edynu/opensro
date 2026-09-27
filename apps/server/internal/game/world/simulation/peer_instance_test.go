package simulation

import (
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestPeerInstanceAndBlockTransitionsOwnMovementDelivery(t *testing.T) {
	const now = int64(1_784_000_000_000)
	viewer := peerSession("viewer", "A", 1, "Viewer")
	peer := peerSession("peer", "A", 2, "Peer")
	viewer.WorldInstance, peer.WorldInstance = 0x10001, 0x20001
	peer.World = movingWorld(t, now)
	source := &fakeSource{sessions: []SessionSnapshot{peer, viewer}}
	push := &fakePusher{}
	ticker := newTestTicker(source, push)
	ticker.RunTick(now)
	if len(push.toSession) != 0 || len(push.toDivision) != 0 {
		t.Fatal("cross-instance peer publication")
	}
	source.sessions[0].WorldInstance = viewer.WorldInstance
	ticker.RunTick(now + 100)
	var opcodes []uint16
	for _, p := range push.toSession {
		if p.sessionID == "viewer" {
			for _, f := range p.frames {
				opcodes = append(opcodes, f.Opcode)
			}
		}
	}
	if len(opcodes) != 4 || opcodes[0] != wire.OpSingleObjectSpawn || opcodes[1] != wire.OpObjectStateRefresh || opcodes[2] != OpMovementAck || opcodes[3] != wire.OpObjectSourceMove {
		t.Fatalf("spawn-before-movement: %x", opcodes)
	}
	push.toSession = nil
	source.sessions[1].World.Spawn.X += 1000
	ticker.RunTick(now + 200)
	if len(peerFramesTo(push, "viewer", wire.OpObjectDespawn)) != 1 || len(peerFramesTo(push, "viewer", wire.OpObjectSourceMove)) != 0 {
		t.Fatal("block exit retained movement recipient")
	}
	push.toSession = nil
	source.sessions[1].World.Spawn = viewer.World.Spawn
	ticker.RunTick(now + 300)
	if len(peerFramesTo(push, "viewer", wire.OpSingleObjectSpawn)) != 1 {
		t.Fatal("block reentry missing spawn")
	}
	push.toSession = nil
	source.sessions[0].WorldInstance = 0x30001
	ticker.RunTick(now + 400)
	if len(peerFramesTo(push, "viewer", wire.OpObjectDespawn)) != 1 || len(peerFramesTo(push, "viewer", wire.OpObjectSourceMove)) != 0 || len(push.toDivision) != 0 {
		t.Fatal("instance departure retained movement recipient")
	}
}
