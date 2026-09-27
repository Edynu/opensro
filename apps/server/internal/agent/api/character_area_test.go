package agentapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/world/worldarea"
)

func testAuthoredAreaCatalog(t *testing.T) *worldarea.Catalog {
	t.Helper()
	root := t.TempDir()
	bundlePath := filepath.Join(root, "assets", "world", "manyang-lab", "region-7e7e.json")
	if err := os.MkdirAll(filepath.Dir(bundlePath), 0o755); err != nil {
		t.Fatal(err)
	}
	population := []map[string]any{{
		"codename": "MOB_CH_MANGNYANG", "x": 1020, "y": 0, "z": 980,
		"maxCount": 1, "respawnDelayMinSec": 5, "respawnDelayMaxSec": 5,
		"respawn": true, "aggressive": false, "sightRange": 0,
		"leashRadius": 140, "generateRadius": 0,
	}}
	area := map[string]any{
		"slug": "manyang-lab", "regionId": 0x7e7e, "access": "gm",
		"entry":                  map[string]any{"x": 900, "y": 0, "z": 920, "angle": 16384},
		"population":             population,
		"worldRegionsPublicPath": "/assets/world/manyang-lab/world-regions-7e7e.json",
		"bundlePublicPath":       "/assets/world/manyang-lab/region-7e7e.json",
	}
	write := func(path string, value any) {
		contents, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, contents, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(bundlePath, map[string]any{"authoredArea": area})
	write(filepath.Join(root, worldarea.CatalogPublicPath), map[string]any{
		"format": "sro-authored-world-area-catalog", "version": 1,
		"areas": []any{area},
	})
	catalog, err := worldarea.Load(root)
	if err != nil {
		t.Fatal(err)
	}
	return catalog
}

func postAreaEntry(
	t *testing.T,
	handler http.Handler,
	characterName string,
) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"characterName": characterName,
		"areaSlug":      "manyang-lab",
	})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/character/enter-area", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, request)
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return recorder, response
}

func postAreaExit(
	t *testing.T,
	handler http.Handler,
	characterName string,
) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"characterName": characterName})
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/character/leave-area", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(recorder, request)
	var response map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return recorder, response
}

func TestCharacterAreaEntryIsAccountScopedGMOnlyAndPreservesWorldState(t *testing.T) {
	api, authority := newTestAPI(t)
	api.authoredAreas = testAuthoredAreaCatalog(t)
	handler := authenticatedHandler(t, api, testAccount)
	postJSON(t, handler, "/character/create", createBody("NormalHero"))
	postJSON(t, handler, "/character/create", createBody("GMHero"))

	characters := authority.Characters().CharactersForDivision(testDivision)
	var gm *domain.Character
	for _, character := range characters {
		if character.Name == "GMHero" {
			gm = character
		}
	}
	if gm == nil {
		t.Fatal("GMHero was not created")
	}
	rebirthRegion := int64(0x62a8)
	ordinaryRegion := int64(0x6b4f)
	ordinaryX, ordinaryY, ordinaryZ := 1205.0, 80.0, 396.0
	ordinaryAngle := int64(4096)
	authority.MutateCharacter(gm, "test-gm-area", func() {
		gm.GMPrivilege = true
		gm.World = &domain.CharacterWorld{
			Spawn: &domain.WorldSpawn{
				RegionID: &ordinaryRegion,
				X:        &ordinaryX,
				Y:        &ordinaryY,
				Z:        &ordinaryZ,
				Angle:    &ordinaryAngle,
			},
			RebirthPoint: &domain.WorldSpawn{RegionID: &rebirthRegion},
			UpdatedAt:    "preserved",
			MoveSegment:  json.RawMessage(`{"stale":true}`),
		}
	})

	forbiddenRecorder, forbidden := postAreaEntry(t, handler, "NormalHero")
	if forbiddenRecorder.Code != http.StatusForbidden || forbidden["code"] != "FORBIDDEN" {
		t.Fatalf("normal character entry = %d %#v", forbiddenRecorder.Code, forbidden)
	}

	acceptedRecorder, accepted := postAreaEntry(t, handler, "GMHero")
	if acceptedRecorder.Code != http.StatusOK || accepted["ok"] != true || accepted["regionId"] != float64(0x7e7e) {
		t.Fatalf("GM area entry = %d %#v", acceptedRecorder.Code, accepted)
	}
	authority.ReadCharacters(testDivision, func([]*domain.Character) {
		if gm.World == nil || gm.World.Spawn == nil || gm.World.Spawn.RegionID == nil || *gm.World.Spawn.RegionID != 0x7e7e ||
			gm.World.Spawn.X == nil || *gm.World.Spawn.X != 900 || gm.World.Spawn.Z == nil || *gm.World.Spawn.Z != 920 {
			t.Fatalf("GM spawn = %+v", gm.World)
		}
		if gm.World.RebirthPoint == nil || gm.World.RebirthPoint.RegionID == nil ||
			*gm.World.RebirthPoint.RegionID != rebirthRegion || gm.World.UpdatedAt != "preserved" {
			t.Fatalf("area entry dropped independent rebirth state: %+v", gm.World)
		}
		if gm.World.MoveSegment != nil {
			t.Fatalf("area entry retained stale movement segment: %s", gm.World.MoveSegment)
		}
		if gm.World.AuthoredAreaReturn == nil || gm.World.AuthoredAreaReturn.RegionID == nil ||
			*gm.World.AuthoredAreaReturn.RegionID != ordinaryRegion ||
			gm.World.AuthoredAreaReturn.X == nil || *gm.World.AuthoredAreaReturn.X != ordinaryX {
			t.Fatalf("area entry did not capture ordinary return spawn: %+v", gm.World)
		}
	})

	// Re-entering or refreshing an authored-area shortcut must not replace the
	// original ordinary-world anchor with the authored-area entry position.
	reentryRecorder, reentry := postAreaEntry(t, handler, "GMHero")
	if reentryRecorder.Code != http.StatusOK || reentry["ok"] != true {
		t.Fatalf("GM area re-entry = %d %#v", reentryRecorder.Code, reentry)
	}

	exitRecorder, exit := postAreaExit(t, handler, "GMHero")
	if exitRecorder.Code != http.StatusOK || exit["ok"] != true || exit["outcome"] != "left" ||
		exit["regionId"] != float64(ordinaryRegion) {
		t.Fatalf("GM area exit = %d %#v", exitRecorder.Code, exit)
	}
	authority.ReadCharacters(testDivision, func([]*domain.Character) {
		if gm.World == nil || !worldSpawnIsSettled(gm.World.Spawn) ||
			*gm.World.Spawn.RegionID != ordinaryRegion || *gm.World.Spawn.X != ordinaryX ||
			*gm.World.Spawn.Y != ordinaryY || *gm.World.Spawn.Z != ordinaryZ ||
			*gm.World.Spawn.Angle != ordinaryAngle || gm.World.AuthoredAreaReturn != nil {
			t.Fatalf("area exit did not restore ordinary spawn: %+v", gm.World)
		}
	})

	idempotentRecorder, idempotent := postAreaExit(t, handler, "GMHero")
	if idempotentRecorder.Code != http.StatusOK || idempotent["ok"] != true ||
		idempotent["outcome"] != "already-outside" || idempotent["regionId"] != float64(ordinaryRegion) {
		t.Fatalf("ordinary-world area exit = %d %#v", idempotentRecorder.Code, idempotent)
	}

	absentRecorder, absent := postAreaExit(t, handler, "NotOnThisShard")
	if absentRecorder.Code != http.StatusOK || absent["ok"] != true ||
		absent["outcome"] != "character-absent" || absent["regionId"] != nil {
		t.Fatalf("absent-character area exit = %d %#v", absentRecorder.Code, absent)
	}

	foreign := authenticatedHandler(t, api, "different-account")
	foreignRecorder, foreignResponse := postAreaEntry(t, foreign, "GMHero")
	if foreignRecorder.Code != http.StatusNotFound || foreignResponse["code"] != "UNKNOWN_CHARACTER" {
		t.Fatalf("foreign account entry = %d %#v", foreignRecorder.Code, foreignResponse)
	}
}

func TestCharacterAreaExitRefusesAuthoredSpawnWithoutReturnAnchor(t *testing.T) {
	api, authority := newTestAPI(t)
	api.authoredAreas = testAuthoredAreaCatalog(t)
	handler := authenticatedHandler(t, api, testAccount)
	postJSON(t, handler, "/character/create", createBody("BrokenGM"))

	character := authority.Characters().CharactersForDivision(testDivision)[0]
	regionID := int64(0x7e7e)
	x, y, z := 1000.0, 0.0, 1000.0
	angle := int64(0)
	authority.MutateCharacter(character, "broken-authored-spawn", func() {
		character.GMPrivilege = true
		character.World = &domain.CharacterWorld{
			Spawn:    &domain.WorldSpawn{RegionID: &regionID, X: &x, Y: &y, Z: &z, Angle: &angle},
			SpawnSet: true,
		}
	})

	recorder, response := postAreaExit(t, handler, "BrokenGM")
	if recorder.Code != http.StatusConflict || response["code"] != "AREA_RETURN_INVALID" {
		t.Fatalf("invalid area exit = %d %#v", recorder.Code, response)
	}
	authority.ReadCharacters(testDivision, func([]*domain.Character) {
		if !worldSpawnIsSettled(character.World.Spawn) ||
			*character.World.Spawn.RegionID != regionID ||
			*character.World.Spawn.X != x || *character.World.Spawn.Z != z {
			t.Fatalf("refused area exit mutated world state: %+v", character.World)
		}
	})
}

func TestCharacterAreaControlLeaseOwnsMutationLifetime(t *testing.T) {
	api, authority := newTestAPI(t)
	api.authoredAreas = testAuthoredAreaCatalog(t)
	handler := authenticatedHandler(t, api, testAccount)
	postJSON(t, handler, "/character/create", createBody("LeaseGM"))
	character := authority.Characters().CharactersForDivision(testDivision)[0]
	authority.MutateCharacter(character, "grant lease-test gm", func() {
		character.GMPrivilege = true
	})

	leaseHeld := false
	acquires := 0
	releases := 0
	api.acquireCharacterControl = func(divisionID, characterName string) (func(), bool) {
		if divisionID != testDivision || characterName != "LeaseGM" {
			t.Fatalf("control identity = %s:%s", divisionID, characterName)
		}
		acquires++
		leaseHeld = true
		return func() {
			if !leaseHeld {
				t.Fatal("control lease released twice")
			}
			leaseHeld = false
			releases++
		}, true
	}

	recorder, response := postAreaEntry(t, handler, "LeaseGM")
	if recorder.Code != http.StatusOK || response["outcome"] != nil {
		t.Fatalf("leased area entry = %d %#v", recorder.Code, response)
	}
	if leaseHeld || acquires != 1 || releases != 1 {
		t.Fatalf("lease lifecycle held=%v acquires=%d releases=%d", leaseHeld, acquires, releases)
	}

	api.acquireCharacterControl = func(string, string) (func(), bool) {
		return nil, false
	}
	recorder, response = postAreaExit(t, handler, "LeaseGM")
	if recorder.Code != http.StatusConflict || response["code"] != "CHARACTER_IN_PLAY" ||
		recorder.Header().Get("Retry-After") != "1" {
		t.Fatalf("busy control lease = %d %#v headers=%v", recorder.Code, response, recorder.Header())
	}
}
