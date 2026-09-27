package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"opensro.online/server/internal/domain"
)

var errIncompatibleSchema = errors.New("authority database schema is incompatible with this binary")

func isVersionMismatch(err error) bool {
	return errors.Is(err, errIncompatibleSchema)
}

// CurrentVersion identifies the only authority-record schema this pre-release
// server accepts. Incompatible pre-release databases are discarded and
// recreated explicitly; production startup never rewrites them in place.
//
// Version 13 replaces world.dungeonMinimap's presentation prefix/label object
// with the semantic-only world.dungeonFloorIndex. The browser resolves all
// minimap presentation from its packed catalogue.
const CurrentVersion = 13

// SkillSeedFunc resolves the current racial base-skill set while preserving
// any already learned skill identifiers.
type SkillSeedFunc func(raceKey string, learned []uint32) ([]uint32, error)

// Meta carries persisted counters that are not owned by an individual
// gameplay record.
type Meta struct {
	GidCounter  uint32           `json:"gidCounter"`
	NextCharID  map[string]int64 `json:"nextCharId,omitempty"`
	NextGuildID map[string]int64 `json:"nextGuildId,omitempty"`
}

// decodeCharacterStrict refuses unknown fields and ownerless records. A
// current-schema load must never silently discard data on its next commit.
func decodeCharacterStrict(raw json.RawMessage) (*domain.Character, error) {
	character := &domain.Character{}
	if err := decodeJSONStrict(raw, character); err != nil {
		return nil, err
	}
	if strings.TrimSpace(character.AccountID) == "" {
		return nil, fmt.Errorf("character %q has no accountId; account ownership is mandatory in schema v%d", character.Name, CurrentVersion)
	}
	return character, nil
}
