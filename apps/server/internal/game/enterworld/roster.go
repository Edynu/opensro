// Package enterworld ports the (retired) Node launcher-api's /mission/bootstrap
// surface into Go: character/appearance resolution and the dress+weapon
// visual-loadout derivation.
//
// Source of truth AT PORT TIME (the Node source was deleted at the Go
// cutover): rebuild/apps/launcher-api/src/server.mjs, CURRENT
// (post-fix) behavior. Two of today's fixes are load-bearing and MUST NOT
// regress (rebuild/scripts/audit_worn_weapon_render.py and
// audit_worn_dress_render.py are the behavioral oracles):
//
//   - Weapon visual (BJ): weaponSetKeys derive from the equipped item's
//     identity (refObjId -> codename -> set key), never latched from the
//     character's creation-time weapon choice.
//   - Dress visual (BY2): dressSetKeys derive per garment part from each
//     equipped garment's own item identity, same pattern as weapons.
package enterworld

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
)

const (
	characterAuthorityFormat  = "sro-server-character-authority"
	characterAuthorityVersion = 2
)

// RosterModel is one semantic playable-character identity extracted from
// RefObjChar. Concrete model resources remain exclusively in the browser
// presentation catalogue.
type RosterModel struct {
	Codename   string  `json:"codename"`
	RefObjID   uint32  `json:"refObjId"`
	BodyRadius float64 `json:"bodyRadius"`
}

// Roster is the server projection's semantic playable-character catalogue.
// Its deliberately closed JSON shape prevents browser GLB/dress/weapon data
// from leaking back into GameWorld composition.
type Roster struct {
	Format  string        `json:"format"`
	Version int           `json:"version"`
	Models  []RosterModel `json:"models"`
}

// LoadRoster reads and validates the verified server-owned identity catalogue.
func LoadRoster(path string) (*Roster, error) {
	text, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	roster := &Roster{}
	decoder := json.NewDecoder(bytes.NewReader(text))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(roster); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("character-authority catalogue contains trailing JSON")
	}
	if roster.Format != characterAuthorityFormat || roster.Version != characterAuthorityVersion {
		return nil, fmt.Errorf("unsupported character-authority catalogue %q v%d", roster.Format, roster.Version)
	}
	seenRefs := make(map[uint32]string, len(roster.Models))
	seenNames := make(map[string]uint32, len(roster.Models))
	for index, model := range roster.Models {
		if model.RefObjID == 0 || model.Codename == "" {
			return nil, fmt.Errorf("models[%d] has an empty identity", index)
		}
		if math.IsNaN(model.BodyRadius) || math.IsInf(model.BodyRadius, 0) || model.BodyRadius <= 0 {
			return nil, fmt.Errorf("models[%d] has invalid bodyRadius %v", index, model.BodyRadius)
		}
		if prior := seenRefs[model.RefObjID]; prior != "" {
			return nil, fmt.Errorf("refObjId %d is duplicated by %s and %s", model.RefObjID, prior, model.Codename)
		}
		if prior := seenNames[model.Codename]; prior != 0 {
			return nil, fmt.Errorf("codename %s is duplicated at refObjId %d and %d", model.Codename, prior, model.RefObjID)
		}
		seenRefs[model.RefObjID] = model.Codename
		seenNames[model.Codename] = model.RefObjID
	}
	return roster, nil
}

// ModelByRefObjID ports findRosterModelByRefObjId: the first model whose
// refObjId matches. Zero means "no ref" and finds nothing, matching the Node
// side where coerceOptionalInteger(undefined/0->clamped 1) never matches a
// real roster row.
func (r *Roster) ModelByRefObjID(refObjID uint32) *RosterModel {
	if r == nil || refObjID == 0 {
		return nil
	}
	for index := range r.Models {
		if r.Models[index].RefObjID == refObjID {
			return &r.Models[index]
		}
	}
	return nil
}

// ModelByCodename ports findRosterModelByCodename.
func (r *Roster) ModelByCodename(codename string) *RosterModel {
	if r == nil || codename == "" {
		return nil
	}
	for index := range r.Models {
		if r.Models[index].Codename == codename {
			return &r.Models[index]
		}
	}
	return nil
}
