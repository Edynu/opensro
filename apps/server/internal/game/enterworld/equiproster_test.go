package enterworld

import (
	"bytes"
	"os"
	"strings"
	"testing"

	log "github.com/sirupsen/logrus"
)

// recordingItems wraps a fakeItems table and records every codename the
// roster resolution consults, so a test can assert a malformed codename is
// never looked up at all.
type recordingItems struct {
	items   fakeItems
	queried []string
}

func (r *recordingItems) ItemRefByCodename(codename string) (*ItemRef, bool) {
	r.queried = append(r.queried, codename)
	row, ok := r.items[codename]
	return row, ok
}

// TestResolveEquipRosterWeaponKeyRaceGenderEquivalence pins the weapon-key ->
// codename mapping for every race/gender prefix a visual set key can carry:
// the gender token strips, the race token stays, and the slot-6 weapon row
// resolves. This is the equivalence contract any refactor of the mapping
// must preserve.
func TestResolveEquipRosterWeaponKeyRaceGenderEquivalence(t *testing.T) {
	cases := []struct {
		weaponKey string
		codename  string
	}{
		{weaponKey: "CH_M_BLADE_01", codename: "ITEM_CH_BLADE_01_A_DEF"},
		{weaponKey: "CH_W_BLADE_01", codename: "ITEM_CH_BLADE_01_A_DEF"},
		{weaponKey: "EU_M_SWORD_01", codename: "ITEM_EU_SWORD_01_A_DEF"},
		{weaponKey: "EU_W_SWORD_01", codename: "ITEM_EU_SWORD_01_A_DEF"},
	}
	for _, c := range cases {
		items := fakeItems{
			c.codename: &ItemRef{RefObjID: 42, Codename: c.codename, TypeIDs: [4]int64{3, 1, 6, 2}, Country: 3, RequiredSex: 2},
		}
		roster := ResolveEquipRoster(VisualLoadout{WeaponSetKeys: []string{c.weaponKey}}, items, true)
		found := false
		for _, item := range roster {
			if item.Slot == 6 && item.Codename == c.codename {
				found = true
			}
		}
		if !found {
			t.Errorf("weapon key %q resolved roster %+v, want a slot-6 %s row", c.weaponKey, roster, c.codename)
		}
	}
}

// TestResolveEquipRosterMalformedWeaponKeyIsAnExplicitSkip probes the
// silent-loss defect: a weapon key WITHOUT the (CH|EU)_[MW]_ prefix used to
// pass through the gender-strip regex unchanged (ReplaceAllString's no-op),
// get looked up as the malformed ITEM_<key>_A_DEF codename, miss, and
// continue with no diagnostic. The non-matching key must instead be an
// explicit skip: never looked up under the malformed codename, no slot-6
// row, and a logged warning naming the key.
func TestResolveEquipRosterMalformedWeaponKeyIsAnExplicitSkip(t *testing.T) {
	var logged bytes.Buffer
	log.SetOutput(&logged)
	defer log.SetOutput(os.Stderr)

	items := &recordingItems{items: testItems()}
	roster := ResolveEquipRoster(VisualLoadout{WeaponSetKeys: []string{"BLADE_01"}}, items, true)

	for _, codename := range items.queried {
		if codename == "ITEM_BLADE_01_A_DEF" {
			t.Errorf("malformed weapon key was looked up as %q - the silent regex no-op path", codename)
		}
	}
	for _, item := range roster {
		if item.Slot == 6 {
			t.Errorf("malformed weapon key produced a slot-6 row %+v", item)
		}
	}
	if !strings.Contains(logged.String(), "BLADE_01") {
		t.Errorf("malformed weapon key skipped without a diagnostic naming it; log output: %q", logged.String())
	}

	if len(roster) != 0 {
		t.Fatalf("malformed loadout seeded unrelated items: %+v", roster)
	}
}
