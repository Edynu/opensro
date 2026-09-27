package simulation

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/item/wire"
	worldgeom "opensro.online/server/internal/game/world"
)

// NpcVisibleAt is shared by bootstrap, ongoing publication and interaction.
// Static NPCs and city gates use the same native message blocks as other
// world objects. RegionScopeRing is a data-loading boundary, not visibility.
// The explicit non-authored development roster retains its anchored contract.
func NpcVisibleAt(npc NpcDef, viewer Spawn) bool {
	return !npc.AuthoredSpawn || worldgeom.InterestVisible(
		worldgeom.RegionXZ{RegionID: viewer.RegionID, X: viewer.X, Z: viewer.Z},
		worldgeom.RegionXZ{RegionID: npc.Spawn.RegionID, X: npc.Spawn.X, Z: npc.Spawn.Z},
	)
}

// NpcScopeFrames reconciles against transport-ADMITTED objects, including the
// bootstrap list. Do not add a second "shown NPCs" cache: enqueue rejection,
// reconnect and scene replacement must never leave a fictitious publication.
// The pusher admits ScopeGID and the complete packet atomically for this scene.
func NpcScopeFrames(roster []NpcDef, session SessionSnapshot, nowMs int64) []Frame {
	if session.PublishedObjects == nil {
		return nil // No publication snapshot: caller has no scene authority.
	}
	shown := make(map[uint32]bool, len(session.PublishedObjects))
	for _, gid := range session.PublishedObjects {
		if gid > domain.NPCGIDBase && gid < domain.GroundItemGIDBase {
			shown[gid] = true
		}
	}
	viewer := session.World.LiveSpawnAt(nowMs)
	var frames []Frame
	for _, npc := range roster {
		visible := session.NpcsEnabled && NpcVisibleAt(npc, viewer)
		if visible && !shown[npc.ObjectID] {
			payload := BuildNpcCreateRow(npc, session.NpcAnchor)
			// CICNPC single-create has the appear byte after the list body;
			// CITeleportGate has no character appearance tail.
			if npc.Teleport == nil {
				payload = append(payload, 0)
			}
			frames = append(frames, Frame{Opcode: wire.OpSingleObjectSpawn, Payload: payload, ScopeGID: npc.ObjectID, ScopeVisible: true})
		} else if !visible && shown[npc.ObjectID] {
			frames = append(frames, Frame{Opcode: wire.OpObjectDespawn, Payload: (wire.ObjectDespawn{Gid: npc.ObjectID}).Encode(), ScopeGID: npc.ObjectID})
		}
	}
	return frames
}
