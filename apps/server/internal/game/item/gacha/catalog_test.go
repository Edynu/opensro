package gacha

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"opensro.online/server/internal/game/enterworld"
)

type testItems map[string]*enterworld.ItemRef

func (items testItems) ItemRefByCodename(codename string) (*enterworld.ItemRef, bool) {
	row, ok := items[codename]
	return row, ok
}

func (items testItems) ItemRefByID(id uint32) (*enterworld.ItemRef, bool) {
	for _, ref := range items {
		if ref.RefObjID == id {
			return ref, true
		}
	}
	return nil, false
}

func TestCatalogAuthorizesOnlyNativeVisibleNpcSet(t *testing.T) {
	dir := t.TempDir()
	writeGachaFixture(t, dir,
		"1 1 4140 100 1 1\n1 2 4141 10000 1 13\n",
		"1 9251 1 2\n",
	)
	catalog, err := LoadCatalog(dir, fixtureItems())
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	if !catalog.HasNpc(9251) {
		t.Fatal("native NPC map row was not admitted")
	}
	if prize, ok := catalog.PrizeForNpc(9251, 1); !ok || prize.SetID != 1 {
		t.Fatalf("visible set entry rejected: %#v, ok=%v", prize, ok)
	}
	if prize, ok := catalog.PrizeForNpc(9251, 13); ok {
		t.Fatalf("hidden alternate-set entry was authorized: %#v", prize)
	}
}

func TestCatalogRejectsDuplicateNpcAuthorityRows(t *testing.T) {
	dir := t.TempDir()
	writeGachaFixture(t, dir,
		"1 1 4140 100 1 1\n1 2 4141 10000 1 13\n",
		"1 9251 1 2\n1 9251 1 2\n",
	)
	_, err := LoadCatalog(dir, fixtureItems())
	if err == nil || !strings.Contains(err.Error(), "duplicates NPC 9251") {
		t.Fatalf("LoadCatalog error = %v, want duplicate-NPC refusal", err)
	}
}

func writeGachaFixture(t *testing.T, dir, prizes, npcMap string) {
	t.Helper()
	for name, body := range map[string]string{
		"gachaitemset.txt": prizes,
		"gachanpcmap.txt":  npcMap,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
}

func fixtureItems() testItems {
	return testItems{
		"REWARD_A": {RefObjID: 4140, Codename: "REWARD_A", TypeIDs: [4]int64{3, 1, 6, 2}},
		"REWARD_B": {RefObjID: 4141, Codename: "REWARD_B", TypeIDs: [4]int64{3, 3, 1, 1}},
		CardCodename: {
			RefObjID:          1,
			Codename:          CardCodename,
			ParamDescriptions: [20]string{LoseCardCodename, WinCardCodename},
			TypeIDs:           [4]int64{3, 3, 14, 1},
		},
		WinCardCodename: {
			RefObjID: 2,
			Codename: WinCardCodename,
			TypeIDs:  [4]int64{3, 3, 14, 2},
		},
		LoseCardCodename: {
			RefObjID: 3,
			Codename: LoseCardCodename,
			TypeIDs:  [4]int64{3, 3, 14, 2},
		},
	}
}

func TestCatalogRejectsIncompleteAuthorityBeforeActivation(t *testing.T) {
	for _, tc := range []struct {
		name, prizes, npcs string
		change             func(testItems)
	}{
		{"empty prizes", "", "1 9251 1 2\n", nil},
		{"empty NPCs", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "", nil},
		{"missing set", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 3 1\n", nil},
		{"zero identity", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n", func(items testItems) { items[CardCodename].RefObjID = 0 }},
		{"wrong identity", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n", func(items testItems) { items[CardCodename].Codename = "wrong" }},
		{"aliased cards", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n", func(items testItems) { items[LoseCardCodename].RefObjID = items[WinCardCodename].RefObjID }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeGachaFixture(t, dir, tc.prizes, tc.npcs)
			items := fixtureItems()
			if tc.change != nil {
				tc.change(items)
			}
			if catalog, err := LoadCatalog(dir, items); err == nil || catalog != nil {
				t.Fatalf("incomplete catalog admitted: %#v, %v", catalog, err)
			}
		})
	}
}

func TestCatalogRewardClosureAndAlternateSetIntegrity(t *testing.T) {
	for _, tc := range []struct {
		name, prizes, npcs, want string
		change                   func(testItems)
	}{
		{"missing visible reward", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n", "reward 4140", func(i testItems) { delete(i, "REWARD_A") }},
		{"missing alternate reward", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n", "reward 4141", func(i testItems) { delete(i, "REWARD_B") }},
		{"missing alternate set", "1 1 4140 100 1 1\n", "1 9251 1 2\n", "missing enabled set 2", nil},
		{"zero alternate set", "1 1 4140 100 1 1\n", "1 9251 1 0\n", "zero set", nil},
		{"inconsistent reward name", "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n", "indexes disagree", func(i testItems) { i["REWARD_A"].Codename = "UNKNOWN" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			writeGachaFixture(t, dir, tc.prizes, tc.npcs)
			items := fixtureItems()
			if tc.change != nil {
				tc.change(items)
			}
			c, err := LoadCatalog(dir, items)
			if c != nil || err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("catalog=%v err=%v, want %s", c, err, tc.want)
			}
		})
	}
	dir := t.TempDir()
	writeGachaFixture(t, dir, "1 1 4140 100 1 1\n1 2 4141 9900 1 13\n1 2 4140 100 1 14\n", "1 9251 1 2\n")
	c, err := LoadCatalog(dir, fixtureItems())
	if err != nil {
		t.Fatal(err)
	}
	names := c.RewardCodenames()
	if strings.Join(names, ",") != "REWARD_A,REWARD_B" {
		t.Fatal(names)
	}
	names[0] = "MUTATED"
	if c.RewardCodenames()[0] != "REWARD_A" {
		t.Fatal("catalog storage escaped")
	}
}

func TestPublishedGachaCatalog(t *testing.T) {
	dir := os.Getenv("SRO_GACHA_TEXTDATA")
	if dir == "" {
		t.Skip("set SRO_GACHA_TEXTDATA to validate published media")
	}
	c, err := LoadCatalog(dir, enterworld.NewTextdataItems(dir))
	if err != nil {
		t.Fatal(err)
	}
	if len(c.prizesByEntry) != 26 || len(c.RewardCodenames()) != 26 || !c.HasNpc(9251) {
		t.Fatalf("unexpected v1.150 reward closure: entries=%d refs=%d", len(c.prizesByEntry), len(c.RewardCodenames()))
	}
}

func TestCatalogUsesAuthoredResultCardFamily(t *testing.T) {
	dir := t.TempDir()
	writeGachaFixture(t, dir, "1 1 4140 100 1 1\n1 2 4141 10000 1 13\n", "1 9251 1 2\n")
	items := fixtureItems()
	items["CUSTOM_WIN"] = items[WinCardCodename]
	delete(items, WinCardCodename)
	items["CUSTOM_WIN"].Codename = "CUSTOM_WIN"
	items[CardCodename].ParamDescriptions[1] = "CUSTOM_WIN"
	c, err := LoadCatalog(dir, items)
	if err != nil || c.WinCard.Codename != "CUSTOM_WIN" {
		t.Fatalf("authored family ignored: %v %v", c, err)
	}
	items[CardCodename].ParamDescriptions[0] = "MISSING"
	if _, err := LoadCatalog(dir, items); err == nil {
		t.Fatal("missing authored result admitted")
	}
}
