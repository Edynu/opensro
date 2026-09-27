/*
===========================================================================

shippedtextdata_shared_test.go - shared shipped textdata for this package's tests

===========================================================================
*/

package enterworld

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"opensro.online/server/internal/gamedata"
)

var serverProjectionRoot = filepath.Join("..", "..", "..", "..", "..", ".generated", "game-data", "1.150", "server")

var realAssetPaths = DevPaths{
	RosterPath:        filepath.Join(serverProjectionRoot, "character-authority", "catalog.json"),
	TextdataDir:       filepath.Join(serverProjectionRoot, "textdata"),
	MissionChatPath:   filepath.Join("..", "..", "..", "config", "mission-chat.json"),
	EquipItemsEnabled: true,
}

// The shipped textdata parses dominate this package's test cost (itemdata
// ~12.6MB + textdataname ~4.2MB, skilldata ~21MB), so the read-only
// shipped-data tests share ONE loader each instead of re-parsing per
// test. The loaders' lazy sync.Once makes a shared instance safe for
// concurrent readers, so this composes with t.Parallel(). TEST-ONLY:
// production wiring (devdeps.go) still builds its own loaders, and a test
// that asserts construction or degradation behavior must keep building
// its own too.
var (
	sharedShippedItemsOnce        sync.Once
	sharedShippedItemsInst        *TextdataItems
	sharedShippedSkillsOnce       sync.Once
	sharedShippedSkillsInst       *TextdataSkills
	sharedShippedSkillsErr        error
	sharedShippedMagicOptionsOnce sync.Once
	sharedShippedMagicOptionsInst *TextdataMagicOptions
)

/*
==================
sharedShippedItems

sharedShippedItems returns the package-wide itemdata loader over the
extracted textdata current-contract tests read (realAssetPaths), skipping
when this checkout has no media.
==================
*/
func sharedShippedItems(t *testing.T) *TextdataItems {
	t.Helper()
	if _, err := os.Stat(realAssetPaths.TextdataDir); err != nil {
		t.Skipf("extracted textdata unavailable: %v", err)
	}
	sharedShippedItemsOnce.Do(func() {
		sharedShippedItemsInst = NewTextdataItems(realAssetPaths.TextdataDir)
	})
	return sharedShippedItemsInst
}

/*
==================
sharedShippedMagicOptions

sharedShippedMagicOptions returns the package-wide magicoption.txt loader
over the extracted textdata (realAssetPaths), skipping when this checkout
has no media.
==================
*/
func sharedShippedMagicOptions(t *testing.T) *TextdataMagicOptions {
	t.Helper()
	if _, err := os.Stat(realAssetPaths.TextdataDir); err != nil {
		t.Skipf("extracted textdata unavailable: %v", err)
	}
	sharedShippedMagicOptionsOnce.Do(func() {
		sharedShippedMagicOptionsInst = NewTextdataMagicOptions(realAssetPaths.TextdataDir)
	})
	return sharedShippedMagicOptionsInst
}

/*
==================
sharedShippedSkills

sharedShippedSkills returns the package-wide skilldata loader from the
same process-level path contract used by GameWorld.
The projection resolves once per process: callers read it inside per-row
loops, and each resolution re-identifies the artifact on disk.
==================
*/
func sharedShippedSkills(t *testing.T) *TextdataSkills {
	t.Helper()
	sharedShippedSkillsOnce.Do(func() {
		dir, err := gamedata.ResolveTextdataDir()
		if err != nil {
			sharedShippedSkillsErr = err
			return
		}
		sharedShippedSkillsInst = NewTextdataSkills(dir)
	})
	if sharedShippedSkillsErr != nil {
		t.Skipf("shipped skilldata not present in this checkout: %v", sharedShippedSkillsErr)
	}
	return sharedShippedSkillsInst
}
