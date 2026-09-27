package main

import (
	agentapi "opensro.online/server/internal/agent/api"
	"opensro.online/server/internal/game/world/simulation"
)

func installMonsterQuery(api *agentapi.API, state *simulation.MonsterState, shard string) {
	if state == nil {
		return
	}
	api.InstallMonsterQuery(func(ref uint32) []agentapi.LiveMonsterPosition {
		values := state.QueryMonsterPositions(shard, ref)
		out := make([]agentapi.LiveMonsterPosition, 0, len(values))
		for _, v := range values {
			out = append(out, agentapi.LiveMonsterPosition{GID: v.GID, RefObjID: v.RefObjID, Name: v.Name, HP: v.HP, RegionID: v.Pose.RegionID, LocalX: v.Pose.X, LocalZ: v.Pose.Z})
		}
		return out
	})
}
