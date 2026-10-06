/*
===========================================================================

preload.go - resolve immutable outdoor navigation before the world ticks

Monster placement and path queries share these caches with player movement.
Loading a first-use region inside the simulation stalls every session. Boot
performs the same resolutions before readiness, without changing query results,
population order, navigation admission or the runtime failure policy.

===========================================================================
*/
package movement

import (
	"fmt"
	"slices"

	"opensro.online/server/internal/game/world/simulation"
)

/*
================
PreloadOutdoorNavigation

Called before publishing the validator to gameplay. Regions and placement
offsets are sorted so startup reads are reproducible. Shared bundles load once
through the existing caches. Missing optional assets retain their cached nil.
================
*/
func (v *WaterValidator) PreloadOutdoorNavigation() (int, error) {
	catalog := v.loadCatalog()
	if catalog == nil {
		return 0, fmt.Errorf("movement: cannot preload absent navigation catalog")
	}
	regions := make([]uint16, 0, len(catalog.RegionsByID))
	for name := range catalog.RegionsByID {
		region := parseRegionID(name)
		if region != 0 && !simulation.IsDungeonRegion(region) {
			regions = append(regions, region)
		}
	}
	slices.Sort(regions)
	regions = slices.Compact(regions)
	seen := make(map[*groundSurface]bool)
	for _, region := range regions {
		surface := v.surfaceForRegion(region)
		if surface == nil || seen[surface] {
			continue
		}
		seen[surface] = true
		offsets := make([]int64, 0, len(surface.objectPlacementsByOffset))
		for offset := range surface.objectPlacementsByOffset {
			offsets = append(offsets, offset)
		}
		slices.Sort(offsets)
		for _, offset := range offsets {
			// offsetKey stores signed sector differences as dx*65536+dz.
			// Recover the signed low word before dividing out the high word.
			dz := int(int16(offset))
			dx := int((offset - int64(dz)) / sectorOffsetStride)
			v.objectNavSetForOffset(surface, dx, dz)
		}
	}
	return len(regions), nil
}
