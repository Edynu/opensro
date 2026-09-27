package monster

import (
	"testing"

	worldgeom "opensro.online/server/internal/game/world"
)

// The adopted path carries the walked surface owners, so the next plan starts
// from the cell under the monster (native source pNavCell) instead of
// re-guessing it from height. A segment the path does not match has no owner.
func TestLiveNavOwnerFollowsAdoptedPathOwners(t *testing.T) {
	deck := worldgeom.NavOwner{Kind: worldgeom.NavOwnerObject, Object: worldgeom.NavObjectCell{Surface: 0x5B87, Object: 4, Cell: 2}}
	from, to := Pose{RegionID: 0x5B87, X: 10, Y: 20}, Pose{RegionID: 0x5B87, X: 100, Y: 20}
	m := MoverState{From: from, To: to, DepartMs: 1000, ArriveMs: 2000}
	flat := func(float64, Pose) (float64, bool) { return 20, true }
	m.AdoptNavigation(NewNavigationPath(from, to, to, 0, flat).WithOwners([]worldgeom.NavOwnerSpan{
		{From: 0, To: .4, Owner: worldgeom.TerrainOwner()},
		{From: .4, To: 1, Owner: deck},
	}))
	if got := m.LiveNavOwner(1200); got != worldgeom.TerrainOwner() {
		t.Fatalf("owner at t=.2 = %+v", got)
	}
	if got := m.LiveNavOwner(1800); got != deck {
		t.Fatalf("owner at t=.8 = %+v", got)
	}
	if got := m.LiveNavOwner(5000); got != deck {
		t.Fatalf("arrived owner = %+v", got)
	}
	m.To.X = 90 // a replaced segment must not reuse the old path's owners
	if got := m.LiveNavOwner(1800); got.Resolved() {
		t.Fatalf("stale path owner leaked: %+v", got)
	}
}
