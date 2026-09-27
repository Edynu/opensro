package agentapi

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"

	"opensro.online/server/internal/domain"
)

// BenchmarkFixtureResetPath is routed through Agent to the selected
// GameWorld. The GameWorld registers it only when the explicit development
// gate is enabled, so a production worker has no teleport-shaped route.
const BenchmarkFixtureResetPath = "/development/benchmark-fixture/reset"

type benchmarkFixtureSpawn struct {
	RegionID int64   `json:"regionId"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Angle    int64   `json:"angle"`
}

type benchmarkFixtureResetRequest struct {
	CharacterName string                `json:"characterName"`
	FixtureID     string                `json:"fixtureId"`
	MovementMode  int64                 `json:"movementMode"`
	Spawn         benchmarkFixtureSpawn `json:"spawn"`
}

func (api *API) handleBenchmarkFixtureReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request benchmarkFixtureResetRequest
	if err := decodeJSONRequest(r.Body, &request); err != nil || !validBenchmarkFixtureReset(request) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "BAD_REQUEST"})
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
	outcome := "reset"
	changed := api.store.UpdateCharacter(character, "benchmark-fixture-reset "+strings.TrimSpace(request.FixtureID), func() bool {
		if character.DeletePending {
			refusal = "CHARACTER_UNAVAILABLE"
			return false
		}
		if benchmarkFixtureWorldMatches(character.World, request) {
			outcome = "already-reset"
			return false
		}
		world := domain.CharacterWorld{}
		if character.World != nil {
			world = *character.World
		}
		regionID, x, y, z, angle := request.Spawn.RegionID, request.Spawn.X, request.Spawn.Y, request.Spawn.Z, request.Spawn.Angle
		movementMode := request.MovementMode
		world.Spawn = &domain.WorldSpawn{RegionID: &regionID, X: &x, Y: &y, Z: &z, Angle: &angle}
		world.AuthoredAreaReturn = nil
		world.MovementMode = &movementMode
		world.SpawnSet = true
		world.MovementSourceSeeded = true
		world.MoveSegment = nil
		world.DungeonFloorIndex = nil
		character.World = &world
		return true
	})
	if !changed && refusal != "" {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": refusal})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"outcome":      outcome,
		"fixtureId":    strings.TrimSpace(request.FixtureID),
		"movementMode": request.MovementMode,
		"spawn":        request.Spawn,
	})
}

func validBenchmarkFixtureReset(request benchmarkFixtureResetRequest) bool {
	return strings.TrimSpace(request.CharacterName) != "" &&
		strings.TrimSpace(request.FixtureID) != "" && len(strings.TrimSpace(request.FixtureID)) <= 128 &&
		request.Spawn.RegionID > 0 && request.Spawn.RegionID <= 0xffff &&
		finiteInRange(request.Spawn.X, 0, 1920) &&
		finiteInRange(request.Spawn.Z, 0, 1920) &&
		finite(request.Spawn.Y) && request.Spawn.Y >= -32768 && request.Spawn.Y <= 32767 &&
		request.Spawn.Angle >= 0 && request.Spawn.Angle <= 0xffff &&
		(request.MovementMode == 1 || request.MovementMode == 3)
}

func finiteInRange(value, minimum, maximum float64) bool {
	return finite(value) && value >= minimum && value < maximum
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func benchmarkFixtureWorldMatches(world *domain.CharacterWorld, request benchmarkFixtureResetRequest) bool {
	if world == nil || world.Spawn == nil || world.Spawn.RegionID == nil || world.Spawn.X == nil ||
		world.Spawn.Y == nil || world.Spawn.Z == nil || world.Spawn.Angle == nil || world.MovementMode == nil {
		return false
	}
	return *world.Spawn.RegionID == request.Spawn.RegionID && *world.Spawn.X == request.Spawn.X &&
		*world.Spawn.Y == request.Spawn.Y && *world.Spawn.Z == request.Spawn.Z &&
		*world.Spawn.Angle == request.Spawn.Angle && *world.MovementMode == request.MovementMode &&
		world.SpawnSet && world.MovementSourceSeeded && world.AuthoredAreaReturn == nil &&
		world.DungeonFloorIndex == nil && len(json.RawMessage(world.MoveSegment)) == 0
}
