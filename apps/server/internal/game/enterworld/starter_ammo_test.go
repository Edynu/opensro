package enterworld

import "testing"

func TestStarterRangedAmmunitionIsSeededOnce(t *testing.T) {
	for _, tc := range []struct {
		key, weapon, ammo string
		kind              int64
	}{
		{"CH_M_BOW_01", "ITEM_CH_BOW_01_A_DEF", "ITEM_ETC_AMMO_ARROW_01_DEF", 6},
		{"EU_W_CROSSBOW_01", "ITEM_EU_CROSSBOW_01_A_DEF", "ITEM_ETC_AMMO_BOLT_01_DEF", 12},
	} {
		t.Run(tc.key, func(t *testing.T) {
			items := fakeItems{
				tc.weapon: &ItemRef{RefObjID: 100, Codename: tc.weapon, TypeIDs: [4]int64{3, 1, 6, tc.kind}},
				tc.ammo:   &ItemRef{RefObjID: 200, Codename: tc.ammo, TypeIDs: [4]int64{3, 3, 4, 1}},
			}
			roster := ResolveEquipRoster(VisualLoadout{WeaponSetKeys: []string{tc.key}}, items, true)
			character := &Character{}
			rows := EnsureMissionInventory(character, roster)
			if len(rows) != 2 || rows[1].Slot != 7 || rows[1].Codename != tc.ammo || rows[1].StackCount != 250 {
				t.Fatalf("starter inventory: %+v", rows)
			}
			character.MissionInventory[1].StackCount = 17
			if got := EnsureMissionInventory(character, roster); len(got) != 2 || got[1].StackCount != 17 {
				t.Fatalf("relogin replenished ammunition: %+v", got)
			}
			if got := ResolveEquipRoster(VisualLoadout{WeaponSetKeys: []string{tc.key}}, items, false); len(got) != 0 {
				t.Fatalf("disabled equipment seeded ammo: %+v", got)
			}
		})
	}
}

func TestStarterShieldIsInventoryNotOnlyPreview(t *testing.T) {
	for _, race := range []string{"CH", "EU"} {
		for _, gender := range []string{"M", "W"} {
			key := race + "_" + gender
			weapon := "ITEM_" + race + "_SWORD_01_A_DEF"
			shield := "ITEM_" + race + "_SHIELD_01_A_DEF"
			items := fakeItems{
				weapon: &ItemRef{RefObjID: 100, Codename: weapon, TypeIDs: [4]int64{3, 1, 6, 2}},
				shield: &ItemRef{RefObjID: 200, Codename: shield, TypeIDs: [4]int64{3, 1, 4, 1}},
			}
			roster := ResolveEquipRoster(VisualLoadout{WeaponSetKeys: ResolveWeaponSetKeys(key, "SWORD")}, items, true)
			c := &Character{}
			rows := EnsureMissionInventory(c, roster)
			if len(rows) != 2 || rows[1].Slot != 7 || rows[1].Codename != shield || rows[1].StackCount != 1 {
				t.Fatalf("%s: missing starter shield: %+v", key, rows)
			}
			c.MissionInventory = c.MissionInventory[:1]
			if rows := EnsureMissionInventory(c, roster); len(rows) != 1 {
				t.Fatalf("%s: removed shield replenished: %+v", key, rows)
			}
		}
	}
}
