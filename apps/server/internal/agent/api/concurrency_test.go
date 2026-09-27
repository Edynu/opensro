package agentapi

import (
	"testing"
	"time"
)

// TestListRacesGameplayMutation is the read-door witness (run under -race):
// gameplay storms the commit door while HTTP lists and select-starts the same
// character.
func TestListRacesGameplayMutation(t *testing.T) {
	api, authority := newTestAPI(t)
	handler := authenticatedHandler(t, api, testAccount)
	postJSON(t, handler, "/character/create", createBody("Racer"))
	character := authority.Characters().CharactersForDivision(testDivision)[0]

	const rounds = 150
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < rounds; i++ {
			level := int64(1 + i%60)
			hp := int64(100 + i)
			reservedAt := time.UnixMilli(
				1_785_000_000_000 + int64(i),
			).UTC().Format(createdAtTimeFormatISO)
			authority.MutateCharacter(character, "race-mutate", func() {
				character.Level = &level
				character.CurrentHP = &hp
				character.DeletePending = i%2 == 0
				character.DeleteReservedAt = reservedAt
			})
		}
	}()

	for i := 0; i < rounds; i++ {
		var list map[string]interface{}
		getJSON(t, handler, "/character/list?divisionId="+testDivision, &list)
		if len(list["characters"].([]interface{})) != 1 {
			t.Fatal("character vanished mid-race")
		}
		postJSON(t, handler, "/agent/packet", map[string]interface{}{
			"nativeOpcode":  selectStartReqOpcode,
			"characterName": "Racer",
		})
	}
	<-done
}

// TestDeleteActionRacesGameplayMutation is the delete-action twin of the list
// race: HTTP alternates reserve/restore while gameplay mutates the same record.
func TestDeleteActionRacesGameplayMutation(t *testing.T) {
	api, authority := newTestAPI(t)
	handler := authenticatedHandler(t, api, testAccount)
	postJSON(t, handler, "/character/create", createBody("Reaver"))
	character := authority.Characters().CharactersForDivision(testDivision)[0]

	const rounds = 150
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < rounds; i++ {
			level := int64(1 + i%60)
			hp := int64(100 + i)
			reservedAt := time.UnixMilli(
				1_785_000_000_000 + int64(i),
			).UTC().Format(createdAtTimeFormatISO)
			authority.MutateCharacter(character, "race-mutate", func() {
				character.Level = &level
				character.CurrentHP = &hp
				character.DeletePending = i%2 == 0
				character.DeleteReservedAt = reservedAt
			})
		}
	}()

	for i := 0; i < rounds; i++ {
		action := 3
		if i%2 == 1 {
			action = 5
		}
		response := postJSON(
			t,
			handler,
			"/character/delete-action",
			map[string]interface{}{
				"action": action, "characterName": "Reaver",
			},
		)
		if response["nativeResult"].(float64) != 1 {
			t.Fatalf(
				"round %d action %d = %v, want success",
				i,
				action,
				response,
			)
		}
		if response["character"].(map[string]interface{})["name"] != "Reaver" {
			t.Fatalf(
				"round %d action %d answered wrong character: %v",
				i,
				action,
				response,
			)
		}
	}
	<-done
}
