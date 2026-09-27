package simulation

import (
	worldgeom "opensro.online/server/internal/game/world"
	"opensro.online/server/internal/game/world/monster"
)

func monsterPoseRegionXZ(p monster.Pose) worldgeom.RegionXZ {
	return worldgeom.RegionXZ{RegionID: p.RegionID, X: p.X, Z: p.Z}
}

func monsterPoseDelta(from, to monster.Pose) (dx, dz float64) {
	return worldgeom.Delta(monsterPoseRegionXZ(from), monsterPoseRegionXZ(to))
}

func normalizeMonsterPose(pose monster.Pose) monster.Pose {
	position := worldgeom.NormalizeOutdoor(monsterPoseRegionXZ(pose))
	pose.RegionID = position.RegionID
	pose.X = position.X
	pose.Z = position.Z
	return pose
}
