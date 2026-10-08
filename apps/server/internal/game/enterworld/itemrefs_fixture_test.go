/*
===========================================================================

itemrefs_fixture_test.go - reference id lookup for enterworld item fixtures

Keep fixture sources consistent with the required ItemRefSource contract.
Lookups use the same records exposed by each fixture's codename lookup.

===========================================================================
*/
package enterworld

/*
================
ItemRefByID
================
*/
func (items fakeItems) ItemRefByID(id uint32) (*ItemRef, bool) {
	for _, ref := range items {
		if ref != nil && ref.RefObjID == id {
			return ref, true
		}
	}
	return nil, false
}

/*
================
ItemRefByID
================
*/
func (cosBootstrapRefSource) ItemRefByID(uint32) (*ItemRef, bool) {
	return nil, false
}

/*
================
ItemRefByID
================
*/
func (s petSkillRefSource) ItemRefByID(id uint32) (*ItemRef, bool) {
	for _, ref := range s.items {
		if ref != nil && ref.RefObjID == id {
			return ref, true
		}
	}
	return nil, false
}
