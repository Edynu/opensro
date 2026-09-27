package enterworld

import (
	"regexp"
	"strings"
)

// VisualLoadout is the bootstrap render contract for the local player: which
// model, dress sets, and weapon sets the client draws, plus the un-gated
// siblings the equipment overlay needs to stay idempotent.
//
// JSON field names are the wire contract the audit scripts and the browser
// client read; they must not drift from the Node payload.
type VisualLoadout struct {
	ModelCodename    string   `json:"modelCodename"`
	DressSetKeys     []string `json:"dressSetKeys"`
	WeaponSetKeys    []string `json:"weaponSetKeys"`
	AnimationSetName string   `json:"animationSetName"`
	HeightScale      float64  `json:"heightScale"`
	VolumeScale      float64  `json:"volumeScale"`

	// WeaponSetKeysWhenWorn is the RENDER answer's un-gated sibling: an
	// unworn weapon must not show on the bootstrap avatar, but gating
	// WeaponSetKeys DESTROYS the key rather than hiding it, so this keeps
	// both readings on the wire. Reading it back from itself also makes the
	// equipment overlay idempotent, which the bootstrap builder relies on.
	WeaponSetKeysWhenWorn []string `json:"weaponSetKeysWhenWorn"`

	// DressSetKeysBase is the creation/persisted dress keys preserved
	// un-overlaid, for the same reason WeaponSetKeysWhenWorn exists: the
	// overlay is re-applied to its own output, so the item-derived grouping
	// must always run against the ORIGINAL keys or a second application
	// would treat the first one's additions as bootstrap truth.
	DressSetKeysBase []string `json:"dressSetKeysBase"`

	// DressPartFilters says, per rendered dress set key, WHICH parts draw
	// from that set. Only present once the equipment overlay has seen a
	// seeded inventory (the bootstrap builder re-applies the overlay after
	// seeding, so the final payload always carries it).
	DressPartFilters map[string][]string `json:"dressPartFilters,omitempty"`
}

// Creation-choice tables, ported verbatim from server.mjs.

type europeWeaponRule struct {
	Kind           string
	ProtectorKinds []string
}

// europeWeaponRules ports missionEuropeWeaponRules ("" = no weapon).
var europeWeaponRules = []europeWeaponRule{
	{Kind: "", ProtectorKinds: nil},
	{Kind: "DAGGER", ProtectorKinds: []string{"LIGHT"}},
	{Kind: "SWORD", ProtectorKinds: []string{"HEAVY", "LIGHT"}},
	{Kind: "TSWORD", ProtectorKinds: []string{"HEAVY", "LIGHT"}},
	{Kind: "AXE", ProtectorKinds: []string{"HEAVY", "LIGHT"}},
	{Kind: "CROSSBOW", ProtectorKinds: []string{"LIGHT"}},
	{Kind: "STAFF", ProtectorKinds: []string{"LIGHT", "CLOTHES"}},
	{Kind: "TSTAFF", ProtectorKinds: []string{"CLOTHES"}},
	{Kind: "HARP", ProtectorKinds: []string{"CLOTHES"}},
	{Kind: "STAFF", ProtectorKinds: []string{"LIGHT", "CLOTHES"}},
}

// chinaWeaponKinds ports missionChinaWeaponKinds ("" = no weapon).
var chinaWeaponKinds = []string{"", "SWORD", "BLADE", "SPEAR", "TBLADE", "BOW"}

// shieldWeaponKeys ports missionShieldWeaponKeys: creation weapon kinds that
// pair an off-hand shield.
var shieldWeaponKeys = map[string]bool{
	"CH_SWORD": true,
	"CH_BLADE": true,
	"EU_SWORD": true,
	"EU_STAFF": true,
}

// nativeDefaultAnimationSet ports missionNativeDefaultAnimationSet.
const nativeDefaultAnimationSet = "default"

var createPreviewStarterDressParts = []string{"BA", "LA"}
var createPreviewProtectorDressParts = []string{"BA", "LA", "FA"}

// CharacterCreationValid validates the authored character-creation controls
// against the same roster and selection tables that assemble the resulting
// appearance. The HTTP boundary owns decoding; this package owns which model,
// weapon and protector combinations exist.
func CharacterCreationValid(character *Character, roster *Roster) bool {
	if character == nil || roster == nil || roster.ModelByCodename(character.ModelCodename) == nil {
		return false
	}
	if !creationIndexInRange(character.HeightIndex, 0, 4) ||
		!creationIndexInRange(character.VolumeIndex, 0, 4) {
		return false
	}

	weaponIndex, weaponValid := creationIndex(character.WeaponIndex, 1)
	protectorIndex, protectorValid := creationIndex(character.ProtectorIndex, 0)
	if !character.WeaponSelected || !weaponValid || !protectorValid ||
		character.ArmorSelected != (protectorIndex > 0) {
		return false
	}

	if ResolveCharacterRaceKey(character) == RaceKeyChina {
		return weaponIndex < int64(len(chinaWeaponKinds)) && protectorIndex <= 3
	}
	if weaponIndex >= int64(len(europeWeaponRules)) || !character.ArmorSelected {
		return false
	}
	return protectorIndex <= int64(len(europeWeaponRules[int(weaponIndex)].ProtectorKinds))
}

func creationIndexInRange(value *int64, minimum, maximum int64) bool {
	if value == nil {
		return false
	}
	return *value >= minimum && *value <= maximum
}

func creationIndex(value *int64, minimum int64) (int64, bool) {
	if value == nil || *value < minimum {
		return 0, false
	}
	return *value, true
}

// nativeWeaponAnimationSetByKind ports missionNativeWeaponAnimationSetByKind
// (including the authored "harf" spelling).
var nativeWeaponAnimationSetByKind = map[string]string{
	"CH_BLADE":    "sword",
	"CH_SWORD":    "sword",
	"CH_TBLADE":   "spear",
	"CH_SPEAR":    "spear",
	"CH_BOW":      "bow",
	"EU_SWORD":    "onehand_sword",
	"EU_TSWORD":   "twohand_sword",
	"EU_AXE":      "dual_axe",
	"EU_STAFF":    "onehand_staff",
	"EU_TSTAFF":   "twohand_staff",
	"EU_CROSSBOW": "bow",
	"EU_DAGGER":   "dagger",
	"EU_HARP":     "harf",
}

// nativeWeaponAnimationSetByTid4 is the string-name projection of v1.150
// ItemTypeWord_ToAnimationSetName (sub_8e6ff0). The equipped RefItemData word
// is the animation authority in retail; creation-time weaponIndex is only a
// bootstrap fallback before slot 6 exists.
var nativeWeaponAnimationSetByTid4 = map[uint16]string{
	2: "sword", 3: "sword",
	4: "spear", 5: "spear",
	6: "bow", 7: "onehand_sword", 8: "twohand_sword",
	9: "dual_axe", 11: "twohand_staff", 12: "bow",
	13: "dagger", 14: "harf", 15: "onehand_staff",
}

// NativeWeaponAnimationSetNameForTypeFlags resolves the named archive set
// from the same packed type word CInterfaceModel reads at equipment slot 6.
// Unknown/unpublished families return empty so callers retain their previous
// evidenced fallback instead of inventing an animation set.
func NativeWeaponAnimationSetNameForTypeFlags(typeFlags uint16) string {
	return nativeWeaponAnimationSetByTid4[(typeFlags>>11)&0x1f]
}

// ResolveWeaponKind ports resolveMissionWeaponKind: the creation weapon kind,
// or "" when no weapon was selected.
func ResolveWeaponKind(c *Character) string {
	if c == nil || !c.WeaponSelected {
		return ""
	}
	if ResolveCharacterRaceKey(c) == RaceKeyEurope {
		weaponIndex := coerceInt(c.WeaponIndex, 0, int64(len(europeWeaponRules)-1), 0)
		return europeWeaponRules[weaponIndex].Kind
	}
	weaponIndex := coerceInt(c.WeaponIndex, 0, int64(len(chinaWeaponKinds)-1), 0)
	return chinaWeaponKinds[weaponIndex]
}

// ResolveProtectorKind ports resolveMissionProtectorKind: the creation armor
// class ("HEAVY"/"LIGHT"/"CLOTHES"), or "" for none.
func ResolveProtectorKind(c *Character, weaponKind string) string {
	if c == nil || !c.ArmorSelected {
		return ""
	}
	protectorIndex := coerceInt(c.ProtectorIndex, 0, 255, 0)
	if protectorIndex <= 0 {
		return ""
	}
	if ResolveCharacterRaceKey(c) == RaceKeyEurope {
		weaponIndex := coerceInt(c.WeaponIndex, 0, int64(len(europeWeaponRules)-1), 0)
		kinds := europeWeaponRules[weaponIndex].ProtectorKinds
		if int(protectorIndex)-1 < len(kinds) {
			return kinds[protectorIndex-1]
		}
		return "CLOTHES"
	}
	switch protectorIndex {
	case 1:
		return "HEAVY"
	case 2:
		return "LIGHT"
	case 3:
		return "CLOTHES"
	default:
		if weaponKind != "" {
			return "CLOTHES"
		}
		return ""
	}
}

// ResolveDressSetKeys ports resolveMissionDressSetKeys: the creation-derived
// dress set (one key; "no protector" degrades to CLOTHES).
func ResolveDressSetKeys(c *Character, key, weaponKind string) []string {
	protectorKind := ResolveProtectorKind(c, weaponKind)
	if protectorKind == "" {
		protectorKind = "CLOTHES"
	}
	return []string{key + "_" + protectorKind + "_01"}
}

// ResolveWeaponSetKeys ports resolveMissionWeaponSetKeys: the creation-derived
// weapon set keys; shield kinds append the off-hand <key>_SHIELD_01, which
// lives in socket 7 and is not what the worn socket-6 row describes.
func ResolveWeaponSetKeys(key, weaponKind string) []string {
	if weaponKind == "" {
		return []string{}
	}
	mainWeaponKey := key + "_" + weaponKind + "_01"
	raceWeaponKey := racePrefixOfKey(key) + "_" + weaponKind
	if shieldWeaponKeys[raceWeaponKey] {
		return []string{mainWeaponKey, key + "_SHIELD_01"}
	}
	return []string{mainWeaponKey}
}

// ResolveNativeWeaponAnimationSetName ports
// resolveMissionNativeWeaponAnimationSetName.
func ResolveNativeWeaponAnimationSetName(key, weaponKind string) string {
	if weaponKind == "" {
		return nativeDefaultAnimationSet
	}
	if name, ok := nativeWeaponAnimationSetByKind[racePrefixOfKey(key)+"_"+weaponKind]; ok {
		return name
	}
	return nativeDefaultAnimationSet
}

// racePrefixOfKey is the Node key.slice(0, 2) on "CH_M"-style keys.
func racePrefixOfKey(key string) string {
	if len(key) < 2 {
		return key
	}
	return key[:2]
}

// ResolveVisualLoadout ports resolveMissionVisualLoadout: the creation- and
// persistence-derived loadout, with the worn-equipment overlay already
// applied (the Node function ends the same way).
func ResolveVisualLoadout(character *Character, roster *Roster, modelRef uint32) VisualLoadout {
	model := roster.ModelByRefObjID(modelRef)
	if model == nil {
		model = roster.ModelByCodename(charModelCodename(character))
	}
	modelCodename := ""
	if model != nil {
		modelCodename = model.Codename
	}
	if modelCodename == "" {
		modelCodename = charModelCodename(character)
	}
	key := RaceGenderKey(character, modelCodename)
	explicitDressSetKeys := filterIdentitySetKeys(charDressSetKeys(character), key)
	explicitWeaponSetKeys := filterIdentitySetKeys(charWeaponSetKeys(character), key)
	weaponKind := ResolveWeaponKind(character)
	protectorKind := ResolveProtectorKind(character, weaponKind)
	dressSetKeys := explicitDressSetKeys
	if len(dressSetKeys) == 0 {
		dressSetKeys = ResolveDressSetKeys(character, key, weaponKind)
	}
	weaponSetKeys := explicitWeaponSetKeys
	if len(weaponSetKeys) == 0 {
		weaponSetKeys = ResolveWeaponSetKeys(key, weaponKind)
	}
	animationSetName := ResolveNativeWeaponAnimationSetName(key, weaponKind)
	dressParts := createPreviewStarterDressParts
	if protectorKind != "" {
		dressParts = createPreviewProtectorDressParts
	}
	dressPartFilters := make(map[string][]string, len(dressSetKeys))
	for _, setKey := range dressSetKeys {
		dressPartFilters[setKey] = copyStrings(dressParts)
	}

	return ApplyEquipmentToVisualLoadout(VisualLoadout{
		ModelCodename:    modelCodename,
		DressSetKeys:     dressSetKeys,
		WeaponSetKeys:    weaponSetKeys,
		AnimationSetName: animationSetName,
		HeightScale:      ResolveCharacterHeightScale(character),
		VolumeScale:      ResolveCharacterVolumeScale(character),
		DressPartFilters: dressPartFilters,
	}, character)
}

func filterIdentitySetKeys(values []string, identityKey string) []string {
	prefix := identityKey + "_"
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if strings.HasPrefix(value, prefix) {
			filtered = append(filtered, value)
		}
	}
	return filtered
}

func charModelCodename(c *Character) string {
	if c == nil {
		return ""
	}
	return c.ModelCodename
}

func charDressSetKeys(c *Character) []string {
	if c == nil {
		return nil
	}
	return c.DressSetKeys
}

func charWeaponSetKeys(c *Character) []string {
	if c == nil {
		return nil
	}
	return c.WeaponSetKeys
}

// ApplyEquipmentToVisualLoadout ports applyMissionEquipmentToVisualLoadout:
// overlay the persisted equipment state onto the loadout-derived visuals so a
// reconnect shows what is ACTUALLY worn. Weapon slot 6 gates WeaponSetKeys;
// garment slots 1/4/5 gate the BA/LA/FA DressPartFilters pieces.
//
// THE KEY ITSELF USED TO BE WRONG on the Node side, and that was the
// user-visible BJ bug: the browser derived its weapon visual from
// character-creation choices, not from the equipped item's refObjId, so a
// character who bootstrapped holding a picked-up weapon was shown the CREATED
// one ("I equiped copper blade, and still have the spear"). The worn item's
// own codename now chooses the mesh on both sides; the creation choice
// survives only as the fallback for weapons whose visual set the roster does
// not carry. The dress half (BY2) is the same fix per garment part.
//
// Idempotent by construction: re-derives from the un-gated siblings, so the
// bootstrap builder can re-apply it after seeding the inventory.
func ApplyEquipmentToVisualLoadout(loadout VisualLoadout, character *Character) VisualLoadout {
	out := loadout
	whenWorn := loadout.WeaponSetKeysWhenWorn
	if whenWorn == nil {
		whenWorn = loadout.WeaponSetKeys
	}
	dressBase := loadout.DressSetKeysBase
	if dressBase == nil {
		dressBase = loadout.DressSetKeys
	}
	out.WeaponSetKeysWhenWorn = copyStrings(whenWorn)
	out.DressSetKeysBase = copyStrings(dressBase)
	if character == nil || character.MissionInventory == nil {
		// No seeded inventory: only the un-gated siblings are added; the
		// bootstrap builder re-applies this overlay once the rows exist so
		// first-ever and restored sessions carry the same payload shape.
		return out
	}

	equipped := make([]InventoryRow, 0, len(character.MissionInventory))
	for _, row := range character.MissionInventory {
		if row.Slot < 13 {
			equipped = append(equipped, row)
		}
	}
	wornWeapon := findRowBySlot(equipped, 6)

	// WHICH SET each garment piece draws from is the worn item's own,
	// exactly as the weapon's mesh is the worn weapon's own. Additive piece
	// by piece: an item whose set/part the roster cannot draw keeps the
	// creation keys for that part.
	prefixLoadout := out
	dressSetKeys, dressPartFilters := wornDressVisual(equipped, out.DressSetKeysBase, prefixLoadout)

	if wornWeapon != nil {
		out.WeaponSetKeys = wornWeaponSetKeys(*wornWeapon, out.WeaponSetKeysWhenWorn, prefixLoadout)
		if animationSetName := NativeWeaponAnimationSetNameForTypeFlags(wornWeapon.TypeFlags); animationSetName != "" {
			out.AnimationSetName = animationSetName
		}
	} else {
		// An unworn weapon must not show on the bootstrap avatar.
		out.WeaponSetKeys = []string{}
	}
	out.DressSetKeys = dressSetKeys
	out.DressPartFilters = dressPartFilters
	return out
}

func findRowBySlot(rows []InventoryRow, slot int64) *InventoryRow {
	for index := range rows {
		if rows[index].Slot == slot {
			return &rows[index]
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// The worn weapon -> its visual set.
//
// This mirrors the client's MissionWeaponVisualCatalog; the duplication is
// deliberate: the two runtimes answer the question at different moments (the
// server at bootstrap, the client at every 0xB06D equip) and both derive from
// the same two authored sources - the itemdata codename on the row and the
// roster's dress.weapons key set - so drift shows up as a weapon changing
// appearance across a reload, not a silent divergence.
// ---------------------------------------------------------------------------

// weaponItemCodenamePattern is the inverse of the equip roster's forward map
// (weaponKey -> ITEM_<race>_<kind>_<nn>_A_DEF), generalised over the grade
// suffix because real drops carry _A/_B/_C rather than the _A_DEF starter
// variant. Measured: the copper blade a player picks up is refObjId 107 =
// ITEM_CH_BLADE_01_A, while the created blade is 3633 = ITEM_CH_BLADE_01_A_DEF
// - keying on the suffix would miss the item that produced the bug report.
var weaponItemCodenamePattern = regexp.MustCompile(`^ITEM_(CH|EU)_([A-Z][A-Z0-9]*)_([0-9]+)(?:_.*)?$`)

// raceGenderPrefixPattern gates the wearer prefix ("CH_M" style).
var raceGenderPrefixPattern = regexp.MustCompile(`^(CH|EU)_([MW])$`)

// setKeyPrefixPattern extracts the wearer prefix from an existing set key.
var setKeyPrefixPattern = regexp.MustCompile(`^(CH|EU)_([MW])_`)

// modelRacePrefixPattern extracts the wearer prefix from a model codename.
var modelRacePrefixPattern = regexp.MustCompile(`^CHAR_(CH|EU)_(MAN|WOMAN)_`)

// WeaponSetKeyForItemCodename ports missionWeaponSetKeyForItemCodename: the
// worn weapon row's own visual set key, or "" when the codename does not
// parse or the item's race does not match the wearer.
//
// The gender token comes from the WEARER, not the item: weapon itemdata does
// not carry one.
func WeaponSetKeyForItemCodename(codename, raceGenderPrefix string) string {
	parsed := weaponItemCodenamePattern.FindStringSubmatch(codename)
	prefix := raceGenderPrefixPattern.FindStringSubmatch(raceGenderPrefix)
	if parsed == nil || prefix == nil || prefix[1] != parsed[1] {
		return ""
	}
	return parsed[1] + "_" + prefix[2] + "_" + parsed[2] + "_" + parsed[3]
}

// raceGenderPrefixFromLoadout ports missionRaceGenderPrefixFromLoadout,
// scanning the loadout's keys in the same order the Node side does.
func raceGenderPrefixFromLoadout(loadout VisualLoadout) string {
	for _, keys := range [][]string{
		loadout.WeaponSetKeysWhenWorn,
		loadout.WeaponSetKeys,
		loadout.DressSetKeys,
	} {
		for _, key := range keys {
			if match := setKeyPrefixPattern.FindStringSubmatch(key); match != nil {
				return match[1] + "_" + match[2]
			}
		}
	}
	if match := modelRacePrefixPattern.FindStringSubmatch(loadout.ModelCodename); match != nil {
		gender := "W"
		if match[2] == "MAN" {
			gender = "M"
		}
		return match[1] + "_" + gender
	}
	return ""
}

// wornWeaponSetKeys ports missionWornWeaponSetKeys. ADDITIVE BY CONSTRUCTION,
// exactly like the client half up to the semantic set identity. Whether that
// set has a renderable mesh is exclusively a browser-catalog decision.
func wornWeaponSetKeys(wornWeaponRow InventoryRow, weaponSetKeysWhenWorn []string, loadout VisualLoadout) []string {
	bootstrapKeys := copyStrings(weaponSetKeysWhenWorn)
	resolved := WeaponSetKeyForItemCodename(
		wornWeaponRow.Codename,
		raceGenderPrefixFromLoadout(loadout),
	)
	if resolved == "" {
		return bootstrapKeys
	}
	// Index 0 is the primary weapon; anything after it is the off-hand the
	// creation choice paired with (ResolveWeaponSetKeys appends
	// <key>_SHIELD_01 for shield kinds), which lives in socket 7 and is not
	// what this row describes.
	out := []string{resolved}
	if len(bootstrapKeys) > 1 {
		out = append(out, bootstrapKeys[1:]...)
	}
	return out
}

// ---------------------------------------------------------------------------
// The worn garments -> their visual sets (the dress twin of the block above).
// ---------------------------------------------------------------------------

// dressItemCodenamePattern parses a garment codename into its owning set key
// and part token. Grade-agnostic like the weapon transform (the pickup
// ITEM_CH_M_HEAVY_01_LA_A and the starter _A_DEF variants draw one set).
var dressItemCodenamePattern = regexp.MustCompile(`^ITEM_((CH|EU)_([MW])_[A-Z][A-Z0-9]*_[0-9]+)_([A-Z]{2})(?:_.*)?$`)

// DressSetKeyForWornRow ports missionDressSetKeyForWornRow: the dress visual
// set for one worn garment row, or "" to keep the creation keys for that
// part. The gates mirror the client's resolveMissionDressVisualPiece:
// parseable garment codename, race+gender matching the WEARER, part token
// matching the socket. Mesh availability is intentionally not consulted by
// GameWorld; the browser's presentation catalogue owns that decision.
func DressSetKeyForWornRow(row InventoryRow, raceGenderPrefix, expectedPart string) string {
	if raceGenderPrefix == "" {
		return ""
	}
	parsed := dressItemCodenamePattern.FindStringSubmatch(row.Codename)
	if parsed == nil || parsed[4] != expectedPart {
		return ""
	}
	setKey := parsed[1]
	if !strings.HasPrefix(setKey, raceGenderPrefix+"_") {
		return ""
	}
	return setKey
}

// dressGarmentSlots maps the garment sockets to their part tokens, in the
// same order the Node side iterates (slot 1 BA, 4 LA, 5 FA).
var dressGarmentSlots = []struct {
	Slot int64
	Part string
}{
	{Slot: 1, Part: "BA"},
	{Slot: 4, Part: "LA"},
	{Slot: 5, Part: "FA"},
}

// wornDressVisual ports missionWornDressVisual: per-part grouping of the worn
// garments under their own set keys, with unresolvable parts staying under
// the creation (base) keys. Set-key insertion order is preserved exactly like
// the Node Map does.
func wornDressVisual(equipped []InventoryRow, dressSetKeysBase []string, loadoutForPrefix VisualLoadout) ([]string, map[string][]string) {
	raceGenderPrefix := raceGenderPrefixFromLoadout(loadoutForPrefix)
	bootstrapParts := []string{}
	type setPartsEntry struct {
		key   string
		parts []string
	}
	ordered := []setPartsEntry{}
	indexByKey := map[string]int{}
	for _, garment := range dressGarmentSlots {
		row := findRowBySlot(equipped, garment.Slot)
		if row == nil {
			continue
		}
		setKey := DressSetKeyForWornRow(*row, raceGenderPrefix, garment.Part)
		if setKey != "" {
			if index, ok := indexByKey[setKey]; ok {
				ordered[index].parts = append(ordered[index].parts, garment.Part)
			} else {
				indexByKey[setKey] = len(ordered)
				ordered = append(ordered, setPartsEntry{key: setKey, parts: []string{garment.Part}})
			}
		} else {
			bootstrapParts = append(bootstrapParts, garment.Part)
		}
	}

	dressSetKeys := []string{}
	dressPartFilters := map[string][]string{}
	for _, setKey := range dressSetKeysBase {
		if setKey == "" {
			continue
		}
		dressSetKeys = append(dressSetKeys, setKey)
		dressPartFilters[setKey] = copyStrings(bootstrapParts)
	}
	for _, entry := range ordered {
		if existing, ok := dressPartFilters[entry.key]; ok {
			merged := copyStrings(existing)
			merged = append(merged, entry.parts...)
			dressPartFilters[entry.key] = merged
			continue
		}
		dressSetKeys = append(dressSetKeys, entry.key)
		dressPartFilters[entry.key] = entry.parts
	}
	return dressSetKeys, dressPartFilters
}
