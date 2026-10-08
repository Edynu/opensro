/*
===========================================================================

itemrefs_fixture_test.go - reference id lookup for combat item fixtures

Keep fixture sources consistent with the required ItemRefSource contract.
Lookups use the same records exposed by each fixture's codename lookup.

===========================================================================
*/
package combat

import "opensro.online/server/internal/game/enterworld"

/*
================
ItemRefByID
================
*/
func (refs itemRefs) ItemRefByID(id uint32) (*enterworld.ItemRef, bool) {
	for _, ref := range refs {
		if ref != nil && ref.RefObjID == id {
			return ref, true
		}
	}
	return nil, false
}
