package monster

import (
	"path/filepath"
	"strconv"
	"strings"
)

// SpawnPoint is one npcpos.txt row: a v1.150 spawn anchor in region-local
// coordinates (x/z inside the 1920-unit region grid; y is terrain height
// and may be negative).
type SpawnPoint struct {
	RefObjID uint32
	RegionID uint16
	X, Y, Z  float64
}

// LoadSpawnPoints parses npcpos.txt under textdataDir (tab-separated
// refObjID/regionID/x/y/z; 8,931 rows in the shipped v1.150 media,
// verified all-5-column on the monster-live board, seq25 B). Rows that do
// not parse are skipped; a missing file degrades to nil.
//
// The rows cover NPCs AND monsters; callers filter through the
// characterdata classification (LoadMonsterRefs).
func LoadSpawnPoints(textdataDir string) []SpawnPoint {
	rows := readTabbedFile(filepath.Join(textdataDir, "npcpos.txt"))
	points := make([]SpawnPoint, 0, len(rows))
	for _, cols := range rows {
		if len(cols) < 5 {
			continue
		}
		refObjID, ok := columnUint32(cols, 0)
		if !ok {
			continue
		}
		regionID, ok := columnRegionID(cols, 1)
		if !ok {
			continue
		}
		x, okX := columnFloat(cols, 2)
		y, okY := columnFloat(cols, 3)
		z, okZ := columnFloat(cols, 4)
		if !okX || !okY || !okZ {
			continue
		}
		points = append(points, SpawnPoint{
			RefObjID: refObjID,
			RegionID: regionID,
			X:        x,
			Y:        y,
			Z:        z,
		})
	}
	return points
}

// columnRegionID parses the npcpos region column, which the shipped media
// writes as a SIGNED 16-bit value: dungeon regions carry the 0x8000
// dungeon-sector bit (simulation.DungeonSectorBit) and print negative (e.g.
// -32767 = uint16 0x8001, the 172-row Donwhang Stone Cave floor). A
// plain unsigned parse silently drops every dungeon spawn - the exact
// red TESTER caught on the first canary run (board seq186).
func columnRegionID(cols []string, index int) (uint16, bool) {
	v, err := strconv.ParseInt(strings.TrimSpace(cols[index]), 10, 17)
	if err != nil || v < -0x8000 || v > 0xFFFF {
		return 0, false
	}
	return uint16(v), true
}
