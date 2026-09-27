// Package loot owns immutable, version-joined monster equipment catalogs.
package loot

// HasEquipmentCountry reports the country buckets supported by shipped media.
func HasEquipmentCountry(country uint8) bool { return country <= 1 }

// MonsterDropRefItemCodenames retains the small starter admission seed. All
// other actual drops are introduced with public reference deltas before spawn.
// Natural keys come from the same generated catalog as selection; no parallel
// filename or item-family list can drift when the catalog changes.
func MonsterDropRefItemCodenames() []string {
	out := make([]string, 0, 318)
	for country := uint8(0); country <= 1; country++ {
		for _, key := range []equipmentKey{{country, 0, false}, {country, 0, true}, {country, 1, true}} {
			if bucket := equipment.buckets[key]; bucket != nil {
				for _, ref := range bucket.refs {
					out = append(out, ref.Codename)
				}
			}
		}
	}
	return out
}
