package enterworld

import (
	"fmt"
	"strings"
)

// TextdataCatalogs is the immutable, server-authoritative view of the
// extracted gameplay tables consumed by EnterWorld and later gameplay lanes.
// It deliberately excludes browser presentation paths: the browser resolves
// models, audio, minimaps, and preload products from its own asset manifests.
//
// Construct this through LoadTextdataCatalogs. That readiness boundary keeps
// filesystem parsing out of the first authenticated request and gives every
// gameplay owner the same in-memory tables.
type TextdataCatalogs struct {
	Items        *TextdataItems
	Levels       *TextdataLevels
	Skills       *TextdataSkills
	MagicOptions *TextdataMagicOptions
}

// LoadTextdataCatalogs materializes all gameplay tables needed by the live
// authority plane before network admission opens. Individual table types stay
// lazy-capable for small unit fixtures, but production composition must fail
// closed here instead of discovering absent media during EnterWorld.
func LoadTextdataCatalogs(dir string) (*TextdataCatalogs, error) {
	if strings.TrimSpace(dir) == "" {
		return nil, fmt.Errorf("textdata readiness: directory is required")
	}

	catalogs := &TextdataCatalogs{
		Items:        NewTextdataItems(dir),
		Levels:       NewTextdataLevels(dir),
		Skills:       NewTextdataSkills(dir),
		MagicOptions: NewTextdataMagicOptions(dir),
	}
	if catalogs.Items.Len() == 0 {
		return nil, fmt.Errorf("textdata readiness: no itemdata rows loaded from %s", dir)
	}
	if catalogs.Levels.Len() == 0 {
		return nil, fmt.Errorf("textdata readiness: no leveldata rows loaded from %s", dir)
	}
	if err := catalogs.Skills.Load(); err != nil {
		return nil, fmt.Errorf("textdata readiness: %w", err)
	}
	if catalogs.MagicOptions.Len() == 0 {
		return nil, fmt.Errorf("textdata readiness: no magicoption rows loaded from %s", dir)
	}
	return catalogs, nil
}
