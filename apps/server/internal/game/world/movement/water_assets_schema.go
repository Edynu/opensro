package movement

import "encoding/json"

type regionCatalog struct {
	RegionsByID map[string][]catalogEntry `json:"regionsById"`
}

type catalogEntry struct {
	ID                     string `json:"id"`
	SeedRegionID           string `json:"seedRegionId"`
	WorldRegionsPublicPath string `json:"worldRegionsPublicPath"`
	BundlePublicPath       string `json:"bundlePublicPath"`
	WorldRegionsPath       string `json:"worldRegionsPath"`
	AuthorityBundlePath    string `json:"bundlePath"`
}

func (entry catalogEntry) worldRegionsPath() string {
	if entry.WorldRegionsPath != "" {
		return entry.WorldRegionsPath
	}
	return entry.WorldRegionsPublicPath
}

func (entry catalogEntry) bundlePath() string {
	if entry.AuthorityBundlePath != "" {
		return entry.AuthorityBundlePath
	}
	return entry.BundlePublicPath
}

type regionIndexFile struct {
	RegionSize   json.Number        `json:"regionSize"`
	SeedRegionID string             `json:"seedRegionId"`
	Regions      []regionIndexEntry `json:"regions"`
}

type regionIndexEntry struct {
	ID                  string `json:"id"`
	BundlePublicPath    string `json:"bundlePublicPath"`
	AuthorityBundlePath string `json:"bundlePath"`
}

func (entry regionIndexEntry) bundlePath() string {
	if entry.AuthorityBundlePath != "" {
		return entry.AuthorityBundlePath
	}
	return entry.BundlePublicPath
}

type regionBundle struct {
	Source struct {
		SectorID string `json:"sectorId"`
		SectorX  int    `json:"sectorX"`
		SectorY  int    `json:"sectorY"`
	} `json:"source"`
	Terrain struct {
		Sectors []bundleSector `json:"sectors"`
		Blocks  []bundleBlock  `json:"blocks"`
	} `json:"terrain"`
	Navmesh struct {
		RegionSize            json.Number     `json:"regionSize"`
		TileSize              json.Number     `json:"tileSize"`
		TilesPerAxis          json.Number     `json:"tilesPerAxis"`
		HeightMapAxisVertices json.Number     `json:"heightMapAxisVertices"`
		Regions               []navmeshRegion `json:"regions"`
	} `json:"navmesh"`
	// Objects names the object-resource index the sealed-deck rescue
	// resolves nav placements through (objectnav.go).
	Objects regionBundleObjects `json:"objects"`
}

type regionBundleObjects struct {
	ResourceIndexPublicPath string `json:"resourceIndexPublicPath"`
	ResourceIndexPath       string `json:"resourceIndexPath"`
}

func (objects regionBundleObjects) resourceIndexPath() string {
	if objects.ResourceIndexPath != "" {
		return objects.ResourceIndexPath
	}
	return objects.ResourceIndexPublicPath
}

// navmeshRegion is the slice of one navmesh region entry the height sampler
// and walkability gate need; every other field (cell contents, edges,
// blockers) stays undecoded.
type navmeshRegion struct {
	Dx          json.Number `json:"dx"`
	Dz          json.Number `json:"dz"`
	HeightMap   string      `json:"heightMap"`
	PlaneType   string      `json:"planeType"`
	PlaneHeight string      `json:"planeHeight"`
	// BlockedTiles is one byte per tile (tilesPerAxis^2, z-major); nonzero
	// fails the client's tile gate.
	BlockedTiles string `json:"blockedTiles"`
	// TileCellIds is one little-endian u32 per tile indexing the cell
	// vector. The client resolves `cells[tileCellIds[tile]] ?? null`, so an
	// index past the cell count is OFF the region graph even when the tile
	// is not blocked - both conditions gate walkability.
	TileCellIds string `json:"tileCellIds"`
	// Cells is the COLUMNAR cell store; only the count (the valid
	// cell-index range) is decoded here.
	Cells struct {
		Count              json.Number `json:"count"`
		MinX               string      `json:"minX"`
		MinZ               string      `json:"minZ"`
		MaxX               string      `json:"maxX"`
		MaxZ               string      `json:"maxZ"`
		ObjectIndexOffsets string      `json:"objectIndexOffsets"`
		ObjectIndices      string      `json:"objectIndices"`
	} `json:"cells"`
	// Objects is the nav object placement list (assetId + position + yaw),
	// kept raw so a malformed list degrades only the sealed-deck rescue
	// (objectnav.go), never the whole surface.
	Objects json.RawMessage `json:"objects"`
}

type bundleSector struct {
	SectorX int           `json:"sectorX"`
	SectorY int           `json:"sectorY"`
	Blocks  []bundleBlock `json:"blocks"`
}

type bundleBlock struct {
	BlockX json.Number `json:"blockX"`
	BlockZ json.Number `json:"blockZ"`
	Water  *struct {
		Type     json.Number `json:"type"`
		WaveType json.Number `json:"waveType"`
		Height   json.Number `json:"height"`
	} `json:"water"`
}
