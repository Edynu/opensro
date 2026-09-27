package enterworld

import (
	"math"
	"opensro.online/server/internal/game/world/simulation"
)

// ResolveGMWarpDestination uses the same surface and area authorities as entry.
// It refuses stranded points instead of silently warping to the race start.
// Called inside the character authority door; it never mutates the character.
func (d *Deps) ResolveGMWarpDestination(c *Character, p simulation.Spawn) (simulation.Spawn, bool) {
	if c == nil || !c.GMPrivilege || d.CanEnterWorldRegion == nil || !d.CanEnterWorldRegion(c, p.RegionID) {
		return p, false
	}
	for _, v := range []float64{p.X, p.Y, p.Z} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return p, false
		}
	}
	if p.RegionID == 0 {
		return p, false
	}
	if simulation.IsDungeonRegion(p.RegionID) {
		if d.SpawnSurfaceHeight == nil {
			return p, false
		}
		_, ok := d.SpawnSurfaceHeight(p.RegionID, p.X, p.Y, p.Z)
		return p, ok
	}
	// Outdoor coordinates are local to one 1920-unit region. Reject malformed
	// frames rather than normalizing an overflow into a different world/region.
	if p.X < 0 || p.X >= 1920 || p.Z < 0 || p.Z >= 1920 || d.SpawnTerrainHeight == nil {
		return p, false
	}
	h, ok := d.SpawnTerrainHeight(p.RegionID, p.X, p.Z)
	if !ok || math.IsNaN(h) || math.IsInf(h, 0) {
		return p, false
	}
	if d.RelocateStrandedSpawn != nil {
		_, stranded, _ := d.RelocateStrandedSpawn(p)
		if stranded {
			return p, false
		}
	}
	entry := LocalPlayerEntry{}
	entry.StartProfile.RegionID = int64(p.RegionID)
	entry.StartProfile.X = p.X
	entry.StartProfile.Y = p.Y
	entry.StartProfile.Z = p.Z
	LiftSpawnAboveTerrain(&entry, d.SpawnTerrainHeight, d.SpawnSurfaceHeight)
	p.Y = entry.StartProfile.Y
	return p, true
}
