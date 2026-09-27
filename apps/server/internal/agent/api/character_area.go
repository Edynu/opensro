package agentapi

import (
	"net/http"
	"strings"

	"opensro.online/server/internal/domain"
)

// handleCharacterEnterArea is a character-select control operation, not a
// gameplay transport mode. It resolves a server-owned area slug, checks the
// authenticated account and GM privilege, captures an ordinary-world return
// anchor, and moves the character's settled spawn. The subsequent EnterWorld
// is entirely ordinary.
func (api *API) handleCharacterEnterArea(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		CharacterName string `json:"characterName"`
		AreaSlug      string `json:"areaSlug"`
	}
	if err := decodeJSONRequest(r.Body, &request); err != nil ||
		strings.TrimSpace(request.CharacterName) == "" ||
		strings.TrimSpace(request.AreaSlug) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "BAD_REQUEST"})
		return
	}
	area, ok := api.authoredAreas.Resolve(request.AreaSlug)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "code": "UNKNOWN_AREA"})
		return
	}

	division := requestShardID(r)
	characterName := strings.TrimSpace(request.CharacterName)
	character := api.findCharacter(division, requestAccountID(r), characterName)
	if character == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "code": "UNKNOWN_CHARACTER"})
		return
	}
	releaseControl, acquired := api.acquireCharacterMutationControl(division, characterName)
	if !acquired {
		writeCharacterInPlay(w)
		return
	}
	defer releaseControl()

	refusal := ""
	changed := api.store.UpdateCharacter(character, "enter-area "+area.Slug, func() bool {
		if character.DeletePending {
			refusal = "CHARACTER_UNAVAILABLE"
			return false
		}
		if !api.authoredAreas.CanEnterRegion(area.RegionID, character.GMPrivilege) {
			refusal = "FORBIDDEN"
			return false
		}
		regionID := int64(area.RegionID)
		x, y, z, angle := area.Entry.X, area.Entry.Y, area.Entry.Z, area.Entry.Angle
		movementMode := int64(0)
		world := domain.CharacterWorld{}
		if character.World != nil {
			world = *character.World
		}
		if worldSpawnIsSettled(world.Spawn) {
			currentRegion := uint16(*world.Spawn.RegionID)
			if _, authored := api.authoredAreas.ResolveRegion(currentRegion); !authored {
				world.AuthoredAreaReturn = cloneWorldSpawn(world.Spawn)
			}
		}
		world.Spawn = &domain.WorldSpawn{
			RegionID: &regionID,
			X:        &x,
			Y:        &y,
			Z:        &z,
			Angle:    &angle,
		}
		world.MovementMode = &movementMode
		world.SpawnSet = true
		world.MovementSourceSeeded = true
		world.MoveSegment = nil
		world.DungeonFloorIndex = nil
		character.World = &world
		return true
	})
	if !changed {
		if refusal == "" {
			refusal = "CHARACTER_UNAVAILABLE"
		}
		status := http.StatusConflict
		if refusal == "FORBIDDEN" {
			status = http.StatusForbidden
		}
		writeJSON(w, status, map[string]any{"ok": false, "code": refusal})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"areaSlug": area.Slug,
		"regionId": area.RegionID,
	})
}

// handleCharacterLeaveArea restores the ordinary-world return anchor captured
// by handleCharacterEnterArea. It is deliberately idempotent: ordinary
// character-select entry does not need to know or care whether a character is
// currently in an authored area. Leaving never requires the area's admission
// grade, so removing a GM grant cannot strand a character inside it.
func (api *API) handleCharacterLeaveArea(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		CharacterName string `json:"characterName"`
	}
	if err := decodeJSONRequest(r.Body, &request); err != nil ||
		strings.TrimSpace(request.CharacterName) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "BAD_REQUEST"})
		return
	}

	division := requestShardID(r)
	characterName := strings.TrimSpace(request.CharacterName)
	character := api.findCharacter(division, requestAccountID(r), characterName)
	if character == nil {
		// Area egress is a pre-EnterWorld cleanup operation. Absence on the
		// authenticated shard proves that there is no authored-area state to
		// restore, so it is a successful no-op. EnterWorld remains the sole
		// authority for admitting (or contextually refusing) that character.
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"outcome":  "character-absent",
			"regionId": nil,
		})
		return
	}
	releaseControl, acquired := api.acquireCharacterMutationControl(division, characterName)
	if !acquired {
		writeCharacterInPlay(w)
		return
	}
	defer releaseControl()

	outcome := "already-outside"
	refusal := ""
	var resultingRegionID *int64
	changed := api.store.UpdateCharacter(character, "leave-authored-area", func() bool {
		if character.DeletePending {
			return false
		}
		if character.World == nil || !worldSpawnIsSettled(character.World.Spawn) {
			return true
		}
		currentRegion := uint16(*character.World.Spawn.RegionID)
		if _, authored := api.authoredAreas.ResolveRegion(currentRegion); !authored {
			regionID := *character.World.Spawn.RegionID
			resultingRegionID = &regionID
			return true
		}

		world := *character.World
		destination := cloneWorldSpawn(world.AuthoredAreaReturn)
		if !worldSpawnIsSettled(destination) || worldSpawnIsAuthored(api, destination) {
			refusal = "AREA_RETURN_INVALID"
			return false
		}
		movementMode := int64(0)
		world.Spawn = destination
		world.AuthoredAreaReturn = nil
		world.MovementMode = &movementMode
		world.SpawnSet = true
		world.MovementSourceSeeded = true
		world.MoveSegment = nil
		world.DungeonFloorIndex = nil
		character.World = &world
		outcome = "left"
		regionID := *destination.RegionID
		resultingRegionID = &regionID
		return true
	})
	if !changed {
		if refusal == "" {
			refusal = "CHARACTER_UNAVAILABLE"
		}
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": refusal})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"outcome":  outcome,
		"regionId": resultingRegionID,
	})
}

func (api *API) acquireCharacterMutationControl(
	divisionID string,
	characterName string,
) (func(), bool) {
	if api.acquireCharacterControl != nil {
		return api.acquireCharacterControl(divisionID, characterName)
	}
	if api.characterInPlay != nil && api.characterInPlay(divisionID, characterName) {
		return nil, false
	}
	return func() {}, true
}

func writeCharacterInPlay(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "1")
	writeJSON(w, http.StatusConflict, map[string]any{
		"ok":   false,
		"code": "CHARACTER_IN_PLAY",
	})
}

func cloneWorldSpawn(source *domain.WorldSpawn) *domain.WorldSpawn {
	if source == nil {
		return nil
	}
	clone := *source
	if source.RegionID != nil {
		value := *source.RegionID
		clone.RegionID = &value
	}
	if source.X != nil {
		value := *source.X
		clone.X = &value
	}
	if source.Y != nil {
		value := *source.Y
		clone.Y = &value
	}
	if source.Z != nil {
		value := *source.Z
		clone.Z = &value
	}
	if source.Angle != nil {
		value := *source.Angle
		clone.Angle = &value
	}
	return &clone
}

func worldSpawnIsSettled(spawn *domain.WorldSpawn) bool {
	return spawn != nil && spawn.RegionID != nil && spawn.X != nil &&
		spawn.Y != nil && spawn.Z != nil && spawn.Angle != nil &&
		*spawn.RegionID >= 0 && *spawn.RegionID <= 0xffff
}

func worldSpawnIsAuthored(api *API, spawn *domain.WorldSpawn) bool {
	if !worldSpawnIsSettled(spawn) {
		return false
	}
	_, authored := api.authoredAreas.ResolveRegion(uint16(*spawn.RegionID))
	return authored
}
