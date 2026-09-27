// Package worldarea owns resource-authored game-area identity and access
// policy. It is a read-only composition input shared by the HTTP entry lane,
// monster population assembly, and security validation; clients never choose
// an authority mode by naming an area.
package worldarea

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const CatalogPublicPath = "assets/world/authored-areas.json"
const authorityCatalogPath = "areas/catalog.json"

type Spawn struct {
	RegionID uint16  `json:"regionId"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Angle    int64   `json:"angle"`
}

type Population struct {
	Codename           string  `json:"codename"`
	X                  float64 `json:"x"`
	Y                  float64 `json:"y"`
	Z                  float64 `json:"z"`
	MaxCount           int     `json:"maxCount"`
	RespawnDelayMinSec int     `json:"respawnDelayMinSec"`
	RespawnDelayMaxSec int     `json:"respawnDelayMaxSec"`
	Respawn            bool    `json:"respawn"`
	Aggressive         bool    `json:"aggressive"`
	SightRange         float64 `json:"sightRange"`
	LeashRadius        float64 `json:"leashRadius"`
	GenerateRadius     float64 `json:"generateRadius"`
}

type Area struct {
	Slug                   string       `json:"slug"`
	RegionID               uint16       `json:"regionId"`
	Access                 string       `json:"access"`
	Entry                  Spawn        `json:"entry"`
	Population             []Population `json:"population"`
	WorldRegionsPublicPath string       `json:"worldRegionsPublicPath"`
	BundlePublicPath       string       `json:"bundlePublicPath"`
}

type catalogFile struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	Areas   []Area `json:"areas"`
}

type authorityCatalogFile struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
	Areas   []Area `json:"areas"`
}

type bundleFile struct {
	AuthoredArea Area `json:"authoredArea"`
}

type Catalog struct {
	bySlug   map[string]Area
	byRegion map[uint16]Area
}

func Load(clientPublicRoot string) (*Catalog, error) {
	contents, err := os.ReadFile(filepath.Join(clientPublicRoot, filepath.FromSlash(CatalogPublicPath)))
	if err != nil {
		return nil, fmt.Errorf("worldarea: read %s: %w", CatalogPublicPath, err)
	}
	var file catalogFile
	if err := json.Unmarshal(contents, &file); err != nil {
		return nil, fmt.Errorf("worldarea: decode %s: %w", CatalogPublicPath, err)
	}
	if file.Format != "sro-authored-world-area-catalog" || file.Version != 1 {
		return nil, fmt.Errorf("worldarea: unsupported catalog %q v%d", file.Format, file.Version)
	}
	catalog := &Catalog{bySlug: make(map[string]Area), byRegion: make(map[uint16]Area)}
	for _, raw := range file.Areas {
		area, err := validateArea(raw, true)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(area.Slug)
		if _, duplicate := catalog.bySlug[key]; duplicate {
			return nil, fmt.Errorf("worldarea: duplicate slug %q", area.Slug)
		}
		if previous, duplicate := catalog.byRegion[area.RegionID]; duplicate {
			return nil, fmt.Errorf("worldarea: region 0x%04X belongs to both %q and %q", area.RegionID, previous.Slug, area.Slug)
		}
		if err := validateBundleMirror(clientPublicRoot, area); err != nil {
			return nil, err
		}
		catalog.bySlug[key] = area
		catalog.byRegion[area.RegionID] = area
	}
	return catalog, nil
}

// LoadAuthority loads the server-owned projection. Unlike Load, it neither
// accepts browser-public paths nor reopens client render bundles to validate a
// mirror; the projection manifest already commits to the exact accepted file.
func LoadAuthority(worldAuthorityDir string) (*Catalog, error) {
	filename := filepath.Join(worldAuthorityDir, filepath.FromSlash(authorityCatalogPath))
	contents, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("worldarea: read authority catalog: %w", err)
	}
	var file authorityCatalogFile
	if err := json.Unmarshal(contents, &file); err != nil {
		return nil, fmt.Errorf("worldarea: decode authority catalog: %w", err)
	}
	if file.Format != "sro-server-world-area-catalog" || file.Version != 1 {
		return nil, fmt.Errorf("worldarea: unsupported authority catalog %q v%d", file.Format, file.Version)
	}
	catalog := &Catalog{bySlug: make(map[string]Area), byRegion: make(map[uint16]Area)}
	for _, raw := range file.Areas {
		area, err := validateArea(raw, false)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(area.Slug)
		if _, duplicate := catalog.bySlug[key]; duplicate {
			return nil, fmt.Errorf("worldarea: duplicate slug %q", area.Slug)
		}
		if previous, duplicate := catalog.byRegion[area.RegionID]; duplicate {
			return nil, fmt.Errorf("worldarea: region 0x%04X belongs to both %q and %q", area.RegionID, previous.Slug, area.Slug)
		}
		catalog.bySlug[key] = area
		catalog.byRegion[area.RegionID] = area
	}
	return catalog, nil
}

func validateArea(area Area, requireResourcePaths bool) (Area, error) {
	area.Slug = strings.TrimSpace(area.Slug)
	area.Access = strings.ToLower(strings.TrimSpace(area.Access))
	area.Entry.RegionID = area.RegionID
	if area.Slug == "" || (area.Access != "gm" && area.Access != "public") {
		return Area{}, fmt.Errorf("worldarea: invalid identity/access for %q", area.Slug)
	}
	if area.RegionID&0x8000 != 0 {
		return Area{}, fmt.Errorf("worldarea: authored outdoor area %q uses dungeon region 0x%04X", area.Slug, area.RegionID)
	}
	if !finite(area.Entry.X, area.Entry.Y, area.Entry.Z) || area.Entry.X < 0 || area.Entry.X >= 1920 || area.Entry.Z < 0 || area.Entry.Z >= 1920 {
		return Area{}, fmt.Errorf("worldarea: entry for %q is outside its region", area.Slug)
	}
	if requireResourcePaths && (!validPublicAssetPath(area.BundlePublicPath) || !validPublicAssetPath(area.WorldRegionsPublicPath)) {
		return Area{}, fmt.Errorf("worldarea: %q has invalid resource paths", area.Slug)
	}
	for index, population := range area.Population {
		if strings.TrimSpace(population.Codename) == "" || !finite(population.X, population.Y, population.Z, population.SightRange, population.LeashRadius, population.GenerateRadius) ||
			population.X < 0 || population.X >= 1920 || population.Z < 0 || population.Z >= 1920 ||
			population.MaxCount < 0 || population.RespawnDelayMinSec < 0 || population.RespawnDelayMaxSec < population.RespawnDelayMinSec ||
			population.SightRange < 0 || population.LeashRadius < 0 || population.GenerateRadius < 0 {
			return Area{}, fmt.Errorf("worldarea: invalid population row %d for %q", index, area.Slug)
		}
	}
	area.Population = append([]Population(nil), area.Population...)
	return area, nil
}

func validateBundleMirror(clientPublicRoot string, area Area) error {
	path := filepath.Join(clientPublicRoot, filepath.FromSlash(strings.TrimPrefix(area.BundlePublicPath, "/")))
	contents, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("worldarea: read bundle for %q: %w", area.Slug, err)
	}
	var bundle bundleFile
	if err := json.Unmarshal(contents, &bundle); err != nil {
		return fmt.Errorf("worldarea: decode bundle for %q: %w", area.Slug, err)
	}
	mirror := bundle.AuthoredArea
	if !strings.EqualFold(mirror.Slug, area.Slug) || mirror.RegionID != area.RegionID || mirror.Access != area.Access ||
		mirror.Entry.X != area.Entry.X || mirror.Entry.Y != area.Entry.Y || mirror.Entry.Z != area.Entry.Z || mirror.Entry.Angle != area.Entry.Angle ||
		!populationEqual(mirror.Population, area.Population) {
		return fmt.Errorf("worldarea: catalog/bundle contract drift for %q", area.Slug)
	}
	return nil
}

func populationEqual(left, right []Population) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func validPublicAssetPath(value string) bool {
	if value != strings.TrimSpace(value) || strings.Contains(value, `\`) {
		return false
	}
	const prefix = "/assets/world/"
	return strings.HasPrefix(value, prefix) && path.Clean(value) == value
}

func finite(values ...float64) bool {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func (catalog *Catalog) Resolve(slug string) (Area, bool) {
	if catalog == nil {
		return Area{}, false
	}
	area, ok := catalog.bySlug[strings.ToLower(strings.TrimSpace(slug))]
	area.Population = append([]Population(nil), area.Population...)
	return area, ok
}

func (catalog *Catalog) Areas() []Area {
	if catalog == nil {
		return nil
	}
	areas := make([]Area, 0, len(catalog.bySlug))
	for _, area := range catalog.bySlug {
		area.Population = append([]Population(nil), area.Population...)
		areas = append(areas, area)
	}
	sort.Slice(areas, func(i, j int) bool { return areas[i].Slug < areas[j].Slug })
	return areas
}

// ResolveRegion returns the authored-area contract for a region. Absence means
// the region is ordinary retail world data and therefore has no authored-area
// access policy.
func (catalog *Catalog) ResolveRegion(regionID uint16) (Area, bool) {
	if catalog == nil {
		return Area{}, false
	}
	area, ok := catalog.byRegion[regionID]
	area.Population = append([]Population(nil), area.Population...)
	return area, ok
}

// CanEnterRegion is the single authorization rule used by both the explicit
// character-select warp and EnterWorld. Unknown regions are normal game
// regions; known authored regions apply their resource-owned access grade.
func (catalog *Catalog) CanEnterRegion(regionID uint16, gmPrivilege bool) bool {
	area, authored := catalog.ResolveRegion(regionID)
	return !authored || area.Access == "public" || gmPrivilege
}
