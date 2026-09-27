/*
===========================================================================

licensed.go - gate tests that need data derived from a licensed client

Many tests check the port against the real game data: the verified server
projection (.generated/game-data), the raw client extraction (../extracted)
or the published browser assets. That data is built locally from a client
the developer is permitted to use; it is never in the repository, so a
fresh clone and CI do not have it.

RequireGameData makes that explicit. Without the data a test skips with a
reason, so `pnpm check source` stays meaningful on a clean machine. Where the
data must be present - the full `pnpm check`, which sets
SRO_REQUIRE_GAME_DATA=1 - a missing piece fails the test instead, so nothing
is silently skipped where it matters.

This package imports nothing from the module, so any package's tests can
use it, including internal/gamedata's own.

===========================================================================
*/
package licensed

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// RequireEnv makes missing game data a test failure instead of a skip.
const RequireEnv = "SRO_REQUIRE_GAME_DATA"

/*
==================
RequireGameData

Skips (or, under SRO_REQUIRE_GAME_DATA=1, fails) the test unless the
verified server projection, the raw client extraction and the published
browser assets are all present. Call it first in any test that reads them.
==================
*/
func RequireGameData(t testing.TB) {
	t.Helper()
	missing, err := missingGameData()
	if err == nil && len(missing) == 0 {
		return
	}
	reason := "licensed game data is not available"
	if err != nil {
		reason += ": " + err.Error()
	}
	for _, path := range missing {
		reason += "\n\tmissing " + path
	}
	if os.Getenv(RequireEnv) == "1" {
		t.Fatalf("%s (%s=1 requires it)", reason, RequireEnv)
	}
	t.Skipf("%s; build it with `pnpm assets build` (set %s=1 to fail instead of skip)", reason, RequireEnv)
}

/*
==================
missingGameData

Returns the data locations that do not exist. Explicit environment roots win
over the checkout layout, matching how the server resolves them.
==================
*/
func missingGameData() ([]string, error) {
	repository, err := repositoryRoot()
	if err != nil {
		return nil, err
	}
	projection := os.Getenv("SRO_SERVER_GAME_DATA_ROOT")
	if projection == "" {
		projection = filepath.Join(repository, ".generated", "game-data", "1.150", "manifest.json")
	}
	required := []string{
		projection,
		filepath.Join(repository, "..", "extracted", "Media_extracted"),
		filepath.Join(repository, ".generated", "client-public", "assets", "packs", "manifest.json"),
	}
	var missing []string
	for _, path := range required {
		if _, statErr := os.Stat(path); statErr != nil {
			missing = append(missing, filepath.Clean(path))
		}
	}
	return missing, nil
}

/*
==================
repositoryRoot

The rebuild checkout: two levels above the Go module (apps/server).
==================
*/
func repositoryRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return filepath.Join(dir, "..", ".."), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no go.mod above the test's working directory")
		}
		dir = parent
	}
}
