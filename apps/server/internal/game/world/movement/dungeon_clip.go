package movement

import (
	"math"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
	"sort"
)

// Dungeon movement never uses outdoor sector arithmetic. Missing coverage and
// cross-dungeon requests retain the start; teleportation owns region changes.
func (v *WaterValidator) clipDungeonPath(from, to simulation.Spawn) ClipReport {
	// 999E62/99A171 propagate a failed block/portal resolution as bit 28.
	// Missing coverage is already rejected by this owner; the spawn adapter
	// must not turn that rejection into a clear move by dropping its result.
	report := ClipReport{Outcome: ClipBlocked, Class: ClipClassObject, Rest: from, NativeResult: monster.NavResultBlocked}
	if from.RegionID != to.RegionID {
		return report
	}
	v.dungeonSpawnOnce.Do(func() { v.dungeonSpawnSurfaces = v.loadDungeonSpawnSurfaces() })
	surface := v.dungeonSpawnSurfaces[from.RegionID]
	if surface == nil {
		return report
	}
	if _, ok := surface.heightAt(from.X, from.Y, from.Z); !ok {
		return report
	}
	dx, dz := to.X-from.X, to.Z-from.Z
	best := math.Inf(1)
	result := uint32(monster.NavResultBlocked)
	var rest objectContactPoint
	cuts := []float64{0, 1}
	passages := resolveObjectPassages(surface.objects, from.X, from.Y, from.Z, to.X, to.Y, to.Z)
	for i, obj := range surface.objects {
		p := obj.placement
		c, s := math.Cos(p.yaw), math.Sin(p.yaw)
		x0, z0 := c*(from.X-p.x)+s*(from.Z-p.z), -s*(from.X-p.x)+c*(from.Z-p.z)
		x1, z1 := c*(to.X-p.x)+s*(to.Z-p.z), -s*(to.X-p.x)+c*(to.Z-p.z)
		for _, m := range obj.meshes {
			var local objectContactPoint
			if t, ok := objectMeshChordContactDetail(m, x0, z0, from.Y-p.y, x1, z1, to.Y-p.y, best, func(edge int, _ bool, _ float64) bool { return passages.permits(i, edge) }, &local); ok {
				result = monster.NavResultClipped
				if local.outline {
					result = monster.NavResultBlocked
				}
				rest = local
				if rest.valid {
					rest.x = contactF32(c*local.x - s*local.z + p.x)
					rest.z = contactF32(s*local.x + c*local.z + p.z)
					rest.y = contactF32(local.y + p.y)
				}
				best = t
			}
			for cell := 0; cell < m.cellCount(); cell++ {
				vertices := [3]uint16{m.cellA[cell], m.cellB[cell], m.cellC[cell]}
				for k, a := range vertices {
					b := vertices[(k+1)%3]
					ax, az := float64(m.vertices[a*3]), float64(m.vertices[a*3+2])
					sx, sz := float64(m.vertices[b*3])-ax, float64(m.vertices[b*3+2])-az
					rx, rz := x1-x0, z1-z0
					den := rx*sz - rz*sx
					if math.Abs(den) < 1e-12 {
						continue
					}
					t, u := ((ax-x0)*sz-(az-z0)*sx)/den, ((ax-x0)*rz-(az-z0)*rx)/den
					if t > 0 && t < 1 && u >= 0 && u <= 1 {
						if len(cuts) >= 65536 {
							return report
						}
						cuts = append(cuts, t)
					}
				}
			}
		}
	}
	for _, block := range surface.blocks {
		for _, o := range block.obstacles {
			a := dx*dx + dz*dz
			if a == 0 {
				break
			}
			x, z := from.X-o.x, from.Z-o.z
			b, c := x*dx+z*dz, x*x+z*z-o.radiusSquared
			var t float64
			if c < 0 {
				if b >= 0 {
					continue
				}
				t = 0
			} else {
				d := b*b - a*c
				if d < 0 {
					continue
				}
				t = (-b - math.Sqrt(d)) / a
				if t < 0 || t > 1 {
					continue
				}
			}
			px, pz := from.X+dx*t, from.Z+dz*t
			hint := from.Y + (to.Y-from.Y)*t
			single := dungeonSpawnSurface{blocks: []dungeonSpawnBlock{block}}
			h, inside := single.heightAt(px, hint, pz)
			if inside && math.Abs(h-hint) <= 2 {
				if t < best {
					best = t
					// 99873E/998756 return bit 0 for a circle contact;
					// 999FE0 retains it after the mesh recheck.
					result = monster.NavResultClipped
					rest = objectContactPoint{}
				}
				break
			}
		}
	}
	sort.Float64s(cuts)
	for i := 1; i < len(cuts); i++ {
		if cuts[i]-cuts[i-1] < 1e-8 {
			continue
		}
		t := (cuts[i] + cuts[i-1]) / 2
		y := from.Y + (to.Y-from.Y)*t
		h, ok := surface.heightAt(from.X+dx*t, y, from.Z+dz*t)
		if (!ok || math.Abs(h-y) > 2) && !passages.covers(t) {
			if cuts[i-1] < best {
				best = cuts[i-1]
				result = monster.NavResultBlocked
				rest = objectContactPoint{}
			}
			break
		}
	}
	if best <= 1 {
		report.NativeResult = result
		if rest.valid {
			report.Rest = from
			report.Rest.X = rest.x
			report.Rest.Y = rest.y
			report.Rest.Z = rest.z
			return report
		}
		t := math.Max(0, best-clipRestPullback/math.Max(math.Max(math.Abs(dx), math.Abs(dz)), clipRestPullback))
		report.Rest = from
		report.Rest.X += dx * t
		report.Rest.Z += dz * t
		report.Rest.Y += (to.Y - from.Y) * t
		return report
	}
	h, ok := surface.heightAt(to.X, to.Y, to.Z)
	if !ok {
		return report
	}
	to.Y = h
	return ClipReport{Outcome: ClipArrived, Rest: to}
}
