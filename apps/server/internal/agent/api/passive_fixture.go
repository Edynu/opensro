/*
===========================================================================

passive_fixture.go - passive-critical test fixture (development shard only)

===========================================================================
*/

package agentapi

import (
	"net/http"

	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/domain/charactervitals"
)

const PassiveCriticalFixturePath = "/development/passive-critical-fixture"

// PassiveCriticalReader reports a character's combat figures. The game
// wiring supplies it, so this adapter never depends on the combat rules.
type PassiveCriticalReader func(snapshot *domain.Character) (map[string]any, error)

func (api *API) InstallPassiveCriticalFixture(read PassiveCriticalReader) {
	if api.benchmarkFixtureControl && read != nil {
		api.passiveCritical = read
	}
}

/*
==================
handlePassiveCriticalFixture

This closed fixture is available only on the explicitly enabled development
test shard, for two closed disposable names owned by the authenticated account. It
never grants learned skills, modifies RNG or substitutes combat packets.
==================
*/
func (api *API) handlePassiveCriticalFixture(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		CharacterName string `json:"characterName"`
		Command       string `json:"command"`
	}
	if decodeJSONRequest(r.Body, &request) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "BAD_FIXTURE_REQUEST"})
		return
	}
	knownProbe := request.CharacterName == "PassiveProbe" || request.CharacterName == "PowerProbe"
	knownCommand := request.Command == "seed" || request.Command == "status"
	if !knownProbe || requestShardID(r) != "test" || !knownCommand {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "code": "BAD_FIXTURE_REQUEST"})
		return
	}
	c := api.findCharacter("test", requestAccountID(r), request.CharacterName)
	if c == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"ok": false, "code": "UNKNOWN_CHARACTER"})
		return
	}
	if request.Command == "seed" {
		release, ok := api.acquireCharacterMutationControl("test", c.Name)
		if !ok {
			writeCharacterInPlay(w)
			return
		}
		defer release()
		// Only a newly created EU actor can receive the initial preset. A
		// repeated seed cannot refill funds, reset learning or heal a live run.
		api.store.UpdateCharacter(c, "passive-critical-fixture-seed", func() bool {
			if c.DeletePending || c.Level == nil || *c.Level != 1 || domain.ResolveCharacterRaceKey(c) != domain.RaceKeyEurope {
				return false
			}
			level, strength, intellect, funds := int64(30), int64(49), int64(49), int64(1000000)
			c.Level = &level
			c.MaxLevel = &level
			c.Strength = &strength
			c.Intellect = &intellect
			c.SkillPoints = &funds
			gold := funds
			c.Gold = &gold
			hp, mp := charactervitals.DerivedMaxHP(c), charactervitals.DerivedMaxMP(c)
			c.CurrentHP = &hp
			c.CurrentMP = &mp
			return true
		})
	}
	var snapshot *domain.Character
	api.store.ReadCharacters("test", func(rows []*domain.Character) {
		for _, row := range rows {
			if row.ID == c.ID {
				snapshot = row.Snapshot()
				break
			}
		}
	})
	if snapshot == nil || snapshot.DeletePending {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false})
		return
	}
	report, err := api.passiveCritical(snapshot)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "reason": err.Error()})
		return
	}
	out := map[string]any{"ok": true, "characterId": snapshot.ID, "level": snapshot.Level, "skills": snapshot.Skills, "masteries": snapshot.Masteries}
	for k, v := range report {
		out[k] = v
	}
	writeJSON(w, http.StatusOK, out)
}
