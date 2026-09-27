package enterworld

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func i64(v int64) *int64 { return &v }

func f64(v float64) *float64 { return &v }

// testRoster mirrors the slice of roster.json the derivations read: model
// rows, authored dress sets with their part lists, and the dress.weapons key
// set. Keys match the real asset so the measured bug cases replay verbatim.
func testRoster() *Roster {
	return &Roster{
		Format:  characterAuthorityFormat,
		Version: characterAuthorityVersion,
		Models: []RosterModel{
			{Codename: "CHAR_CH_MAN_ADVENTURER", RefObjID: 1907, BodyRadius: 4},
			{Codename: "CHAR_CH_WOMAN_ADVENTURER", RefObjID: 1920, BodyRadius: 4},
			{Codename: "CHAR_EU_MAN_ADVENTURER", RefObjID: 14726, BodyRadius: 4},
		},
	}
}

// chinaSpearman is the measured BJ fixture: a China male created with the
// SPEAR choice (missionChinaWeaponKinds[3]), no armor selection.
func chinaSpearman() *Character {
	return &Character{
		Name:           "asd2",
		RaceIndex:      i64(RaceChina),
		Gender:         i64(GenderMale),
		ModelCodename:  "CHAR_CH_MAN_ADVENTURER",
		ModelRef:       i64(1907),
		WeaponSelected: true,
		WeaponIndex:    i64(3),
	}
}

func TestCharacterCreationValidUsesTheAuthoredSelectionTables(t *testing.T) {
	base := Character{
		ModelCodename:  "CHAR_CH_MAN_ADVENTURER",
		HeightIndex:    i64(0),
		VolumeIndex:    i64(0),
		WeaponIndex:    i64(3),
		ProtectorIndex: i64(0),
		WeaponSelected: true,
	}
	roster := testRoster()

	cases := []struct {
		name      string
		mutate    func(*Character)
		wantValid bool
	}{
		{name: "china without protector", wantValid: true},
		{name: "unknown model", mutate: func(c *Character) { c.ModelCodename = "CHAR_UNKNOWN" }},
		{name: "height outside slider", mutate: func(c *Character) { c.HeightIndex = i64(5) }},
		{name: "weapon zero", mutate: func(c *Character) { c.WeaponIndex = i64(0) }},
		{name: "selection flag mismatch", mutate: func(c *Character) { c.ArmorSelected = true }},
		{name: "china protector three", mutate: func(c *Character) {
			c.ArmorSelected = true
			c.ProtectorIndex = i64(3)
		}, wantValid: true},
		{name: "china protector four", mutate: func(c *Character) {
			c.ArmorSelected = true
			c.ProtectorIndex = i64(4)
		}},
		{name: "europe dagger light", mutate: func(c *Character) {
			c.ModelCodename = "CHAR_EU_MAN_ADVENTURER"
			c.WeaponIndex = i64(1)
			c.ArmorSelected = true
			c.ProtectorIndex = i64(1)
		}, wantValid: true},
		{name: "europe dagger has no second protector", mutate: func(c *Character) {
			c.ModelCodename = "CHAR_EU_MAN_ADVENTURER"
			c.WeaponIndex = i64(1)
			c.ArmorSelected = true
			c.ProtectorIndex = i64(2)
		}},
		{name: "europe requires protector", mutate: func(c *Character) {
			c.ModelCodename = "CHAR_EU_MAN_ADVENTURER"
			c.WeaponIndex = i64(2)
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			character := base
			if tc.mutate != nil {
				tc.mutate(&character)
			}
			if got := CharacterCreationValid(&character, roster); got != tc.wantValid {
				t.Fatalf("CharacterCreationValid() = %v, want %v for %+v", got, tc.wantValid, character)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Audit-oracle ports. These reimplement the VERDICT logic of
// rebuild/scripts/audit_worn_weapon_render.py and
// audit_worn_dress_render.py over an in-process loadout, so the Go bootstrap
// is held to the same MATCH bar as the live Node server.
// ---------------------------------------------------------------------------

var auditWeaponCodenamePattern = regexp.MustCompile(`^ITEM_(CH|EU)_([A-Z][A-Z0-9]*)_([0-9]+)(?:_.*)?$`)

// weaponAuditMatches is audit_worn_weapon_render.py's verdict: the PRIMARY
// rendered weapon key must end with the worn codename's _KIND_NN token.
func weaponAuditMatches(t *testing.T, wornCodename string, rendered []string) bool {
	t.Helper()
	parsed := auditWeaponCodenamePattern.FindStringSubmatch(wornCodename)
	if parsed == nil {
		t.Fatalf("audit oracle cannot parse worn codename %q", wornCodename)
	}
	kindNumber := "_" + parsed[2] + "_" + parsed[3]
	if len(rendered) == 0 {
		return false
	}
	return strings.HasSuffix(rendered[0], kindNumber)
}

var auditDressCodenamePattern = regexp.MustCompile(`^ITEM_((CH|EU)_([MW])_[A-Z][A-Z0-9]*_[0-9]+)_([A-Z]{2})(?:_.*)?$`)

var auditPartBySlot = map[int64]string{1: "BA", 4: "LA", 5: "FA"}

// dressAuditVerdict is audit_worn_dress_render.py's per-part verdict: for
// every worn garment whose codename parses to the socket's part, the item's
// OWN set key must own that part in dressPartFilters AND appear in
// dressSetKeys. Returns (comparableParts, mismatches).
func dressAuditVerdict(loadout VisualLoadout, inventory []InventoryRow) (int, int) {
	checked := 0
	mismatches := 0
	for _, slot := range []int64{1, 4, 5} {
		part := auditPartBySlot[slot]
		row := findRowBySlot(inventory, slot)
		if row == nil {
			continue
		}
		parsed := auditDressCodenamePattern.FindStringSubmatch(row.Codename)
		if parsed == nil || parsed[4] != part {
			continue
		}
		checked++
		setKey := parsed[1]
		owner := ""
		for key, parts := range loadout.DressPartFilters {
			for _, owned := range parts {
				if owned == part {
					owner = key
				}
			}
		}
		inRendered := false
		for _, key := range loadout.DressSetKeys {
			if key == setKey {
				inRendered = true
			}
		}
		if owner != setKey || !inRendered {
			mismatches++
		}
	}
	return checked, mismatches
}

// ---------------------------------------------------------------------------
// Weapon visual (BJ): worn identity drives the render, never the
// creation-time latch.
// ---------------------------------------------------------------------------

// TestWornWeaponRenderMatchesAuditOracle replays the measured bug report:
// created with the spear, wearing the picked-up copper blade (refObjId 107,
// ITEM_CH_BLADE_01_A - the _A grade, NOT the _A_DEF starter variant). The
// pre-fix server rendered CH_M_SPEAR_01; the fixed contract renders the worn
// blade's own set.
func TestWornWeaponRenderMatchesAuditOracle(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 6, RefObjID: 107, Codename: "ITEM_CH_BLADE_01_A", TypeFlags: 0x2c},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)

	if got := loadout.WeaponSetKeys; !reflect.DeepEqual(got, []string{"CH_M_BLADE_01"}) {
		t.Fatalf("weaponSetKeys = %v, want the WORN blade's own set [CH_M_BLADE_01]", got)
	}
	if got := loadout.WeaponSetKeysWhenWorn; !reflect.DeepEqual(got, []string{"CH_M_SPEAR_01"}) {
		t.Fatalf("weaponSetKeysWhenWorn = %v, want the creation spear kept as the un-gated sibling", got)
	}
	if !weaponAuditMatches(t, "ITEM_CH_BLADE_01_A", loadout.WeaponSetKeys) {
		t.Fatalf("audit_worn_weapon_render verdict: MISMATCH (rendered %v for worn ITEM_CH_BLADE_01_A)", loadout.WeaponSetKeys)
	}
}

// TestWornWeaponGradeVariantsAllMatch: the set-key transform is
// grade-agnostic (_A, _B, _C and the _A_DEF starter all draw one set).
func TestWornWeaponGradeVariantsAllMatch(t *testing.T) {
	for _, codename := range []string{
		"ITEM_CH_BLADE_01_A",
		"ITEM_CH_BLADE_01_B",
		"ITEM_CH_BLADE_01_A_DEF",
		"ITEM_CH_BLADE_01",
	} {
		character := chinaSpearman()
		character.MissionInventory = []InventoryRow{{Slot: 6, Codename: codename}}
		loadout := ResolveVisualLoadout(character, testRoster(), 1907)
		if !weaponAuditMatches(t, codename, loadout.WeaponSetKeys) {
			t.Errorf("worn %s rendered %v, want primary key ending _BLADE_01", codename, loadout.WeaponSetKeys)
		}
	}
}

// TestWornWeaponKeepsOffhandSibling: index 0 is the primary weapon; the
// off-hand the creation choice paired with (socket 7) survives the override.
func TestWornWeaponKeepsOffhandSibling(t *testing.T) {
	character := chinaSpearman()
	character.WeaponIndex = i64(1) // SWORD, a shield kind: [CH_M_SWORD_01, CH_M_SHIELD_01]
	character.MissionInventory = []InventoryRow{
		{Slot: 6, Codename: "ITEM_CH_BLADE_01_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	want := []string{"CH_M_BLADE_01", "CH_M_SHIELD_01"}
	if !reflect.DeepEqual(loadout.WeaponSetKeys, want) {
		t.Fatalf("weaponSetKeys = %v, want worn primary + creation off-hand %v", loadout.WeaponSetKeys, want)
	}
}

// TestWornWeaponPublishesSemanticKeyWithoutServerMeshCatalogue proves that
// GameWorld does not make a browser presentation-availability decision.
func TestWornWeaponPublishesSemanticKeyWithoutServerMeshCatalogue(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 6, Codename: "ITEM_CH_TBLADE_09_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if !reflect.DeepEqual(loadout.WeaponSetKeys, []string{"CH_M_TBLADE_09"}) {
		t.Fatalf("weaponSetKeys = %v, want semantic worn identity [CH_M_TBLADE_09]", loadout.WeaponSetKeys)
	}
}

// TestWornWeaponRaceMismatchKeepsCreationKeys: the item's race token must
// match the WEARER's prefix (the gender token always comes from the wearer).
func TestWornWeaponRaceMismatchKeepsCreationKeys(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 6, Codename: "ITEM_EU_SWORD_01_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if !reflect.DeepEqual(loadout.WeaponSetKeys, []string{"CH_M_SPEAR_01"}) {
		t.Fatalf("weaponSetKeys = %v, want creation fallback [CH_M_SPEAR_01]", loadout.WeaponSetKeys)
	}
}

// TestUnwornWeaponDoesNotRender: with a seeded inventory and an empty weapon
// socket the render answer is [], while the un-gated sibling keeps the
// creation key on the wire.
func TestUnwornWeaponDoesNotRender(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{} // seeded, weapon unworn
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if len(loadout.WeaponSetKeys) != 0 {
		t.Fatalf("weaponSetKeys = %v, want [] for an unworn weapon", loadout.WeaponSetKeys)
	}
	if !reflect.DeepEqual(loadout.WeaponSetKeysWhenWorn, []string{"CH_M_SPEAR_01"}) {
		t.Fatalf("weaponSetKeysWhenWorn = %v, want [CH_M_SPEAR_01]", loadout.WeaponSetKeysWhenWorn)
	}
}

// TestFirstBootstrapWithoutInventoryKeepsCreationKeys: before inventory is
// seeded, the resolved creation outfit is already a complete render contract.
// Inventory overlay may replace individual parts later, but the roster list
// and first bootstrap must never expose an unfiltered whole dress set.
func TestFirstBootstrapWithoutInventoryKeepsCreationKeys(t *testing.T) {
	character := chinaSpearman() // MissionInventory nil
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if !reflect.DeepEqual(loadout.WeaponSetKeys, []string{"CH_M_SPEAR_01"}) {
		t.Fatalf("weaponSetKeys = %v, want creation [CH_M_SPEAR_01] before seeding", loadout.WeaponSetKeys)
	}
	wantFilters := map[string][]string{"CH_M_CLOTHES_01": {"BA", "LA"}}
	if !reflect.DeepEqual(loadout.DressPartFilters, wantFilters) {
		t.Fatalf("dressPartFilters = %v, want creation filters %v", loadout.DressPartFilters, wantFilters)
	}
	if !reflect.DeepEqual(loadout.DressSetKeysBase, []string{"CH_M_CLOTHES_01"}) {
		t.Fatalf("dressSetKeysBase = %v, want [CH_M_CLOTHES_01]", loadout.DressSetKeysBase)
	}
}

// ---------------------------------------------------------------------------
// Dress visual (BY2): each garment part draws from the worn item's own set.
// ---------------------------------------------------------------------------

// TestWornDressRenderMatchesAuditOracle replays the measured dress twin:
// heavy pants worn over a clothes loadout. The pre-fix server kept
// dressSetKeys [CH_M_CLOTHES_01] with LA under the CREATION set; the fixed
// contract draws LA from the worn item's own CH_M_HEAVY_01.
func TestWornDressRenderMatchesAuditOracle(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 1, Codename: "ITEM_CH_M_CLOTHES_01_BA_A_DEF"},
		{Slot: 4, Codename: "ITEM_CH_M_HEAVY_01_LA_A"},
		{Slot: 5, Codename: "ITEM_CH_M_CLOTHES_01_FA_A_DEF"},
		{Slot: 6, Codename: "ITEM_CH_BLADE_01_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)

	wantKeys := []string{"CH_M_CLOTHES_01", "CH_M_HEAVY_01"}
	if !reflect.DeepEqual(loadout.DressSetKeys, wantKeys) {
		t.Fatalf("dressSetKeys = %v, want base + worn addition %v", loadout.DressSetKeys, wantKeys)
	}
	if got := loadout.DressPartFilters["CH_M_CLOTHES_01"]; !reflect.DeepEqual(got, []string{"BA", "FA"}) {
		t.Fatalf("clothes set parts = %v, want [BA FA]", got)
	}
	if got := loadout.DressPartFilters["CH_M_HEAVY_01"]; !reflect.DeepEqual(got, []string{"LA"}) {
		t.Fatalf("heavy set parts = %v, want [LA]", got)
	}
	checked, mismatches := dressAuditVerdict(loadout, character.MissionInventory)
	if checked != 3 || mismatches != 0 {
		t.Fatalf("audit_worn_dress_render verdict: %d/%d parts mismatch (filters %v, keys %v)",
			mismatches, checked, loadout.DressPartFilters, loadout.DressSetKeys)
	}
}

// TestWornDressAllPartsFromWornSet: a full worn set replaces every part; the
// creation set stays rendered but owns no parts.
func TestWornDressAllPartsFromWornSet(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 1, Codename: "ITEM_CH_M_HEAVY_01_BA_A"},
		{Slot: 4, Codename: "ITEM_CH_M_HEAVY_01_LA_A"},
		{Slot: 5, Codename: "ITEM_CH_M_HEAVY_01_FA_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if got := loadout.DressPartFilters["CH_M_CLOTHES_01"]; len(got) != 0 {
		t.Fatalf("creation set owns parts %v, want none", got)
	}
	if got := loadout.DressPartFilters["CH_M_HEAVY_01"]; !reflect.DeepEqual(got, []string{"BA", "LA", "FA"}) {
		t.Fatalf("worn set parts = %v, want [BA LA FA] in slot order", got)
	}
	checked, mismatches := dressAuditVerdict(loadout, character.MissionInventory)
	if checked != 3 || mismatches != 0 {
		t.Fatalf("audit verdict: %d/%d parts mismatch", mismatches, checked)
	}
}

// TestWornDressForeignRaceKeepsCreationPart: a garment whose race+gender
// prefix does not match the wearer cannot resolve a set, so its part stays
// under the creation keys (the additive fallback, same as weapons).
func TestWornDressForeignRaceKeepsCreationPart(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 4, Codename: "ITEM_EU_M_HEAVY_01_LA_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if !reflect.DeepEqual(loadout.DressSetKeys, []string{"CH_M_CLOTHES_01"}) {
		t.Fatalf("dressSetKeys = %v, want creation only", loadout.DressSetKeys)
	}
	if got := loadout.DressPartFilters["CH_M_CLOTHES_01"]; !reflect.DeepEqual(got, []string{"LA"}) {
		t.Fatalf("creation set parts = %v, want [LA] kept under the creation set", got)
	}
}

// TestWornDressPublishesSemanticPartWithoutServerMeshCatalogue proves that
// the browser, not GameWorld, decides whether a semantic set has a mesh.
func TestWornDressPublishesSemanticPartWithoutServerMeshCatalogue(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 4, Codename: "ITEM_CH_M_LEGLESS_01_LA_A"},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	wantKeys := []string{"CH_M_CLOTHES_01", "CH_M_LEGLESS_01"}
	if !reflect.DeepEqual(loadout.DressSetKeys, wantKeys) {
		t.Fatalf("dressSetKeys = %v, want semantic set identities %v", loadout.DressSetKeys, wantKeys)
	}
	if got := loadout.DressPartFilters["CH_M_LEGLESS_01"]; !reflect.DeepEqual(got, []string{"LA"}) {
		t.Fatalf("worn semantic set parts = %v, want [LA]", got)
	}
}

// TestWornDressPartTokenMustMatchSocket: an item in the pants socket whose
// codename carries a different part token cannot claim the part.
func TestWornDressPartTokenMustMatchSocket(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 4, Codename: "ITEM_CH_M_HEAVY_01_BA_A"}, // BA token in the LA socket
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if got := loadout.DressPartFilters["CH_M_CLOTHES_01"]; !reflect.DeepEqual(got, []string{"LA"}) {
		t.Fatalf("creation set parts = %v, want [LA] (socket part, not the item's token)", got)
	}
	if _, ok := loadout.DressPartFilters["CH_M_HEAVY_01"]; ok {
		t.Fatalf("mismatched-token item must not add its set, filters %v", loadout.DressPartFilters)
	}
}

// ---------------------------------------------------------------------------
// Overlay mechanics.
// ---------------------------------------------------------------------------

// TestOverlayIdempotent: the bootstrap builder re-applies the overlay to its
// own output after seeding the inventory; a second application must be a
// no-op, for the weapon and the dress halves alike.
func TestOverlayIdempotent(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{
		{Slot: 1, Codename: "ITEM_CH_M_CLOTHES_01_BA_A_DEF"},
		{Slot: 4, Codename: "ITEM_CH_M_HEAVY_01_LA_A"},
		{Slot: 6, Codename: "ITEM_CH_BLADE_01_A", TypeFlags: 3 << 11},
	}
	roster := testRoster()
	once := ResolveVisualLoadout(character, roster, 1907)
	twice := ApplyEquipmentToVisualLoadout(once, character)
	if !reflect.DeepEqual(once, twice) {
		t.Fatalf("overlay is not idempotent:\nonce  %+v\ntwice %+v", once, twice)
	}
}

// TestExplicitPersistedKeysWinOverCreation: persisted dress/weapon keys are
// bootstrap fallbacks. The worn slot overrides both the weapon mesh and its
// animation set from one RefItemData identity.
func TestExplicitPersistedKeysWinOverCreation(t *testing.T) {
	character := chinaSpearman()
	character.WeaponSetKeys = []string{"CH_M_BOW_01"}
	character.DressSetKeys = []string{"CH_M_LIGHT_01"}
	character.AnimationSetName = "bow"
	character.MissionInventory = []InventoryRow{
		{Slot: 6, Codename: "ITEM_CH_BLADE_01_A", TypeFlags: 3 << 11},
	}
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	if !reflect.DeepEqual(loadout.WeaponSetKeys, []string{"CH_M_BLADE_01"}) {
		t.Fatalf("weaponSetKeys = %v, worn identity must override the persisted latch too", loadout.WeaponSetKeys)
	}
	if !reflect.DeepEqual(loadout.WeaponSetKeysWhenWorn, []string{"CH_M_BOW_01"}) {
		t.Fatalf("weaponSetKeysWhenWorn = %v, want persisted [CH_M_BOW_01]", loadout.WeaponSetKeysWhenWorn)
	}
	if !reflect.DeepEqual(loadout.DressSetKeysBase, []string{"CH_M_LIGHT_01"}) {
		t.Fatalf("dressSetKeysBase = %v, want persisted [CH_M_LIGHT_01]", loadout.DressSetKeysBase)
	}
	if loadout.AnimationSetName != "sword" {
		t.Fatalf("animationSetName = %q, want slot-6 native set \"sword\"", loadout.AnimationSetName)
	}
}

func TestNativeWeaponAnimationSetNameForTypeFlags(t *testing.T) {
	cases := map[uint16]string{
		2: "sword", 3: "sword", 4: "spear", 5: "spear", 6: "bow",
		7: "onehand_sword", 8: "twohand_sword", 9: "dual_axe",
		11: "twohand_staff", 12: "bow", 13: "dagger", 14: "harf",
		15: "onehand_staff",
	}
	for tid4, want := range cases {
		if got := NativeWeaponAnimationSetNameForTypeFlags(tid4 << 11); got != want {
			t.Errorf("tid4 %d animation set = %q, want %q", tid4, got, want)
		}
	}
	if got := NativeWeaponAnimationSetNameForTypeFlags(0); got != "" {
		t.Fatalf("non-weapon animation set = %q, want unresolved", got)
	}
}

// TestVisualLoadoutJSONContract: the exact field names and empty-array (not
// null) encodings the audit scripts and the browser client read.
func TestVisualLoadoutJSONContract(t *testing.T) {
	character := chinaSpearman()
	character.MissionInventory = []InventoryRow{} // unworn weapon -> [] on the wire
	loadout := ResolveVisualLoadout(character, testRoster(), 1907)
	data, err := json.Marshal(loadout)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{
		"modelCodename", "dressSetKeys", "weaponSetKeys", "animationSetName",
		"heightScale", "volumeScale", "weaponSetKeysWhenWorn", "dressSetKeysBase",
		"dressPartFilters",
	} {
		if _, ok := fields[key]; !ok {
			t.Errorf("payload lacks %q (have %s)", key, data)
		}
	}
	if string(fields["weaponSetKeys"]) != "[]" {
		t.Errorf("weaponSetKeys encodes as %s, want [] (never null)", fields["weaponSetKeys"])
	}
}

// ---------------------------------------------------------------------------
// Creation-choice derivations (the fallback half the overlay builds on).
// ---------------------------------------------------------------------------

func TestResolveWeaponKindTables(t *testing.T) {
	cases := []struct {
		name      string
		character *Character
		want      string
	}{
		{"notSelected", &Character{RaceIndex: i64(RaceChina), WeaponIndex: i64(2)}, ""},
		{"chinaIndex0", &Character{WeaponSelected: true, RaceIndex: i64(RaceChina), WeaponIndex: i64(0)}, ""},
		{"chinaBlade", &Character{WeaponSelected: true, RaceIndex: i64(RaceChina), WeaponIndex: i64(2)}, "BLADE"},
		{"chinaBow", &Character{WeaponSelected: true, RaceIndex: i64(RaceChina), WeaponIndex: i64(5)}, "BOW"},
		{"chinaClampHigh", &Character{WeaponSelected: true, RaceIndex: i64(RaceChina), WeaponIndex: i64(99)}, "BOW"},
		{"europeDagger", &Character{WeaponSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(1)}, "DAGGER"},
		{"europeHarp", &Character{WeaponSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(8)}, "HARP"},
		{"europeIndex9Staff", &Character{WeaponSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(9)}, "STAFF"},
		{"europeAbsentIndex", &Character{WeaponSelected: true, RaceIndex: i64(RaceEurope)}, ""},
	}
	for _, tc := range cases {
		if got := ResolveWeaponKind(tc.character); got != tc.want {
			t.Errorf("%s: kind = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestResolveProtectorKindTables(t *testing.T) {
	cases := []struct {
		name      string
		character *Character
		kind      string
		want      string
	}{
		{"noArmor", &Character{RaceIndex: i64(RaceChina), ProtectorIndex: i64(1)}, "SPEAR", ""},
		{"chinaHeavy", &Character{ArmorSelected: true, RaceIndex: i64(RaceChina), ProtectorIndex: i64(1)}, "SPEAR", "HEAVY"},
		{"chinaLight", &Character{ArmorSelected: true, RaceIndex: i64(RaceChina), ProtectorIndex: i64(2)}, "SPEAR", "LIGHT"},
		{"chinaClothes", &Character{ArmorSelected: true, RaceIndex: i64(RaceChina), ProtectorIndex: i64(3)}, "SPEAR", "CLOTHES"},
		{"chinaIndex4WithWeapon", &Character{ArmorSelected: true, RaceIndex: i64(RaceChina), ProtectorIndex: i64(4)}, "SPEAR", "CLOTHES"},
		{"chinaIndex4NoWeapon", &Character{ArmorSelected: true, RaceIndex: i64(RaceChina), ProtectorIndex: i64(4)}, "", ""},
		{"chinaIndex0", &Character{ArmorSelected: true, RaceIndex: i64(RaceChina), ProtectorIndex: i64(0)}, "SPEAR", ""},
		{"europeSwordHeavy", &Character{ArmorSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(2), ProtectorIndex: i64(1)}, "SWORD", "HEAVY"},
		{"europeSwordLight", &Character{ArmorSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(2), ProtectorIndex: i64(2)}, "SWORD", "LIGHT"},
		{"europeSwordOutOfRange", &Character{ArmorSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(2), ProtectorIndex: i64(3)}, "SWORD", "CLOTHES"},
		{"europeTstaffClothes", &Character{ArmorSelected: true, RaceIndex: i64(RaceEurope), WeaponIndex: i64(7), ProtectorIndex: i64(1)}, "TSTAFF", "CLOTHES"},
	}
	for _, tc := range cases {
		if got := ResolveProtectorKind(tc.character, tc.kind); got != tc.want {
			t.Errorf("%s: protector = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestResolveWeaponSetKeysShieldPairs(t *testing.T) {
	cases := []struct {
		key, kind string
		want      []string
	}{
		{"CH_M", "", []string{}},
		{"CH_M", "SPEAR", []string{"CH_M_SPEAR_01"}},
		{"CH_M", "SWORD", []string{"CH_M_SWORD_01", "CH_M_SHIELD_01"}},
		{"CH_W", "BLADE", []string{"CH_W_BLADE_01", "CH_W_SHIELD_01"}},
		{"EU_M", "SWORD", []string{"EU_M_SWORD_01", "EU_M_SHIELD_01"}},
		{"EU_M", "STAFF", []string{"EU_M_STAFF_01", "EU_M_SHIELD_01"}},
		{"EU_W", "TSWORD", []string{"EU_W_TSWORD_01"}},
	}
	for _, tc := range cases {
		if got := ResolveWeaponSetKeys(tc.key, tc.kind); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("ResolveWeaponSetKeys(%q, %q) = %v, want %v", tc.key, tc.kind, got, tc.want)
		}
	}
}

func TestResolveNativeWeaponAnimationSetName(t *testing.T) {
	cases := []struct {
		key, kind string
		want      string
	}{
		{"CH_M", "", "default"},
		{"CH_M", "BLADE", "sword"},
		{"CH_W", "TBLADE", "spear"},
		{"EU_M", "HARP", "harf"},
		{"EU_W", "CROSSBOW", "bow"},
		{"EU_M", "NOSUCH", "default"},
	}
	for _, tc := range cases {
		if got := ResolveNativeWeaponAnimationSetName(tc.key, tc.kind); got != tc.want {
			t.Errorf("animation(%q, %q) = %q, want %q", tc.key, tc.kind, got, tc.want)
		}
	}
}

func TestWeaponSetKeyForItemCodename(t *testing.T) {
	cases := []struct {
		codename, prefix string
		want             string
	}{
		{"ITEM_CH_BLADE_01_A", "CH_M", "CH_M_BLADE_01"},
		{"ITEM_CH_BLADE_01_A_DEF", "CH_M", "CH_M_BLADE_01"},
		{"ITEM_CH_SPEAR_02_B", "CH_W", "CH_W_SPEAR_02"},
		{"ITEM_EU_TSWORD_03_C", "EU_M", "EU_M_TSWORD_03"},
		// The wearer's gender token, never the item's (weapon itemdata
		// carries none).
		{"ITEM_CH_BLADE_01_A", "CH_W", "CH_W_BLADE_01"},
		// Race mismatch between item and wearer.
		{"ITEM_EU_SWORD_01_A", "CH_M", ""},
		// Not a weapon shape.
		{"ITEM_CH_M_HEAVY_01_LA_A", "CH_M", ""},
		{"ITEM_ETC_GOLD_01", "CH_M", ""},
		{"", "CH_M", ""},
		{"ITEM_CH_BLADE_01_A", "", ""},
	}
	for _, tc := range cases {
		if got := WeaponSetKeyForItemCodename(tc.codename, tc.prefix); got != tc.want {
			t.Errorf("WeaponSetKeyForItemCodename(%q, %q) = %q, want %q", tc.codename, tc.prefix, got, tc.want)
		}
	}
}

func TestDressSetKeyForWornRow(t *testing.T) {
	cases := []struct {
		name     string
		codename string
		prefix   string
		part     string
		want     string
	}{
		{"heavyPantsGradeA", "ITEM_CH_M_HEAVY_01_LA_A", "CH_M", "LA", "CH_M_HEAVY_01"},
		{"starterDef", "ITEM_CH_M_CLOTHES_01_BA_A_DEF", "CH_M", "BA", "CH_M_CLOTHES_01"},
		{"bareGrade", "ITEM_CH_M_HEAVY_01_FA", "CH_M", "FA", "CH_M_HEAVY_01"},
		{"partTokenMismatch", "ITEM_CH_M_HEAVY_01_BA_A", "CH_M", "LA", ""},
		{"wearerPrefixMismatch", "ITEM_CH_M_HEAVY_01_LA_A", "CH_W", "LA", ""},
		{"foreignRace", "ITEM_EU_M_HEAVY_01_LA_A", "CH_M", "LA", ""},
		{"semanticSetDoesNotNeedServerMesh", "ITEM_CH_M_ARMOR_09_LA_A", "CH_M", "LA", "CH_M_ARMOR_09"},
		{"semanticPartDoesNotNeedServerMesh", "ITEM_CH_M_LEGLESS_01_LA_A", "CH_M", "LA", "CH_M_LEGLESS_01"},
		{"noPrefix", "ITEM_CH_M_HEAVY_01_LA_A", "", "LA", ""},
		{"weaponShape", "ITEM_CH_BLADE_01_A", "CH_M", "LA", ""},
	}
	for _, tc := range cases {
		row := InventoryRow{Codename: tc.codename}
		if got := DressSetKeyForWornRow(row, tc.prefix, tc.part); got != tc.want {
			t.Errorf("%s: DressSetKeyForWornRow = %q, want %q", tc.name, got, tc.want)
		}
	}
}
