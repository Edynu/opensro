/*
===========================================================================

itemrefs_fixture_test.go - reference id lookup for progression item fixtures

Keep fixture sources consistent with the required ItemRefSource contract.
Lookups use the same records exposed by each fixture's codename lookup.

===========================================================================
*/
package progression

import "opensro.online/server/internal/game/enterworld"

/*
================
ItemRefByID
================
*/
func (emptyItemRefs) ItemRefByID(uint32) (*enterworld.ItemRef, bool) {
	return nil, false
}

/*
================
ItemRefByID
================
*/
func (s passiveItemSource) ItemRefByID(id uint32) (*enterworld.ItemRef, bool) {
	if s.ref == nil || s.ref.RefObjID != id {
		return nil, false
	}
	return s.ref, true
}
