package agentapi

import (
	"net/http"
	"strings"
)

const FollowFixturePath = "/development/follow-fixture"

// Installed once, before listeners start, by development-only composition.
type FollowFixtureControl func(division, character, command string) (any, error)

func (api *API) InstallFollowFixture(control FollowFixtureControl) {
	if api.benchmarkFixtureControl {
		api.followFixture = control
	}
}

func (api *API) handleFollowFixture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		CharacterName string `json:"characterName"`
		Command       string `json:"command"`
	}
	if err := decodeJSONRequest(r.Body, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "BAD_REQUEST"})
		return
	}
	division, name := requestShardID(r), strings.TrimSpace(request.CharacterName)
	if api.findCharacter(division, requestAccountID(r), name) == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "code": "UNKNOWN_CHARACTER"})
		return
	}
	result, err := api.followFixture(division, name, request.Command)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "code": "FIXTURE_REFUSED", "reason": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "fixture": result})
}
