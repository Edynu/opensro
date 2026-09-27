package grounditem

import (
	"reflect"
	"sync"
	"testing"
)

func testItem(refObjID uint32) Item {
	return Item{
		RefObjID:  refObjID,
		Codename:  "ITEM_CH_SWORD_01_A_RARE",
		TypeFlags: 0x08AC,
		Position:  Point{RegionID: 0x6B4F, X: 1205, Z: 396},
		Y:         80,
		DroppedBy: "asd",
	}
}

// Drops start above the player (100000+) and NPC (200000+) entity bands.
func TestAddAllocatesFromTheGroundItemBand(t *testing.T) {
	registry := NewRegistry()

	first := registry.Add("1", testItem(11459))
	second := registry.Add("1", testItem(11460))

	if first.Gid != GidBase+1 {
		t.Fatalf("first gid = %d, want %d", first.Gid, GidBase+1)
	}
	if second.Gid != GidBase+2 {
		t.Fatalf("second gid = %d, want %d", second.Gid, GidBase+2)
	}
	if GidBase != 300000 {
		t.Fatalf("GidBase = %d, want 300000", GidBase)
	}
}

// The registry is the sole allocator, so a caller cannot force a gid and
// collide with an existing drop.
func TestAddIgnoresACallerSuppliedGid(t *testing.T) {
	registry := NewRegistry()

	item := testItem(11459)
	item.Gid = 999
	stored := registry.Add("1", item)

	if stored.Gid == 999 {
		t.Fatal("a caller-supplied gid was honoured")
	}
	if _, ok := registry.Get("1", 999); ok {
		t.Fatal("the drop was filed under the caller-supplied gid")
	}
	if _, ok := registry.Get("1", stored.Gid); !ok {
		t.Fatalf("the drop is not retrievable under its allocated gid %d", stored.Gid)
	}
}

// Divisions are isolated: a drop in one is invisible in another.
func TestDivisionsAreIsolated(t *testing.T) {
	registry := NewRegistry()

	stored := registry.Add("1", testItem(11459))

	if _, ok := registry.Get("2", stored.Gid); ok {
		t.Fatal("a drop leaked into another division")
	}
	if got := registry.Count("2"); got != 0 {
		t.Fatalf("the other division holds %d entries, want 0", got)
	}
	if got := registry.Count("1"); got != 1 {
		t.Fatalf("the owning division holds %d entries, want 1", got)
	}
}

// Two players racing for the same drop both reach Remove; exactly one wins,
// and the loser is the one told "cannot be picked".
func TestRemoveIsAuthoritativeAndIdempotent(t *testing.T) {
	registry := NewRegistry()
	stored := registry.Add("1", testItem(11459))

	got, ok := registry.Remove("1", stored.Gid)
	if !ok {
		t.Fatal("the first removal failed")
	}
	if got.RefObjID != 11459 {
		t.Fatalf("removed refObjId = %d, want 11459", got.RefObjID)
	}

	if _, ok := registry.Remove("1", stored.Gid); ok {
		t.Fatal("the second removal also succeeded; the registry is not authoritative")
	}
	if got := registry.Count("1"); got != 0 {
		t.Fatalf("count after removal = %d, want 0", got)
	}
}

func TestRemoveUnknownDivisionOrGid(t *testing.T) {
	registry := NewRegistry()

	if _, ok := registry.Remove("nope", 300001); ok {
		t.Fatal("removing from an unknown division succeeded")
	}
	registry.Add("1", testItem(11459))
	if _, ok := registry.Remove("1", 999999); ok {
		t.Fatal("removing an unknown gid succeeded")
	}
}

// An object list built from All must be stable, so it is ordered by gid.
func TestAllIsOrderedByGid(t *testing.T) {
	registry := NewRegistry()
	for i := 0; i < 8; i++ {
		registry.Add("1", testItem(uint32(11459+i)))
	}
	// Punch a hole to make sure ordering survives removal.
	registry.Remove("1", GidBase+4)

	items := registry.All("1")
	if len(items) != 7 {
		t.Fatalf("entry count = %d, want 7", len(items))
	}
	for index := 1; index < len(items); index++ {
		if items[index-1].Gid >= items[index].Gid {
			t.Fatalf("entries are not ordered by gid: %d before %d", items[index-1].Gid, items[index].Gid)
		}
	}
}

func TestClearDropsTheDivision(t *testing.T) {
	registry := NewRegistry()
	registry.Add("1", testItem(11459))
	registry.Add("2", testItem(11460))

	registry.Clear("1")

	if got := registry.Count("1"); got != 0 {
		t.Fatalf("cleared division holds %d entries, want 0", got)
	}
	if got := registry.Count("2"); got != 1 {
		t.Fatalf("the other division holds %d entries, want 1", got)
	}
}

// Sessions run on their own goroutines and share a division's drops, so the
// allocator must not hand out a duplicate gid under concurrency.
func TestConcurrentAddsAllocateUniqueGids(t *testing.T) {
	registry := NewRegistry()

	const goroutines = 16
	const perGoroutine = 32

	var wait sync.WaitGroup
	seen := make(chan uint32, goroutines*perGoroutine)

	for i := 0; i < goroutines; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			for j := 0; j < perGoroutine; j++ {
				seen <- registry.Add("1", testItem(11459)).Gid
			}
		}()
	}
	wait.Wait()
	close(seen)

	gids := make(map[uint32]bool)
	for gid := range seen {
		if gids[gid] {
			t.Fatalf("gid %d was allocated twice", gid)
		}
		gids[gid] = true
	}
	if len(gids) != goroutines*perGoroutine {
		t.Fatalf("allocated %d unique gids, want %d", len(gids), goroutines*perGoroutine)
	}
	if got := registry.Count("1"); got != goroutines*perGoroutine {
		t.Fatalf("registry holds %d entries, want %d", got, goroutines*perGoroutine)
	}
}

func TestIsGold(t *testing.T) {
	if testItem(11459).IsGold() {
		t.Fatal("an equipment drop reported itself as gold")
	}
	gold := testItem(3810)
	gold.GoldAmount = 8800
	if !gold.IsGold() {
		t.Fatal("a gold heap did not report itself as gold")
	}
}

// The spawn row must carry the registry entry's position and gid, and the
// single-object form must set the appear byte a fresh drop presents with.
func TestSpawnRowMirrorsTheEntry(t *testing.T) {
	registry := NewRegistry()
	stored := registry.Add("1", testItem(11459))

	row := stored.SpawnRow(true)
	if row.Gid != stored.Gid {
		t.Fatalf("row gid = %d, want %d", row.Gid, stored.Gid)
	}
	if row.RefObjID != 11459 {
		t.Fatalf("row refObjId = %d, want 11459", row.RefObjID)
	}
	if row.RegionID != 0x6B4F || row.X != 1205 || row.Y != 80 || row.Z != 396 {
		t.Fatalf("row position = %+v, want region 0x6B4F at (1205, 80, 396)", row.Position)
	}
	if !row.WithAppearTail || row.AppearFlag != 1 {
		t.Fatalf("single-object row appear tail = %v/%d, want true/1", row.WithAppearTail, row.AppearFlag)
	}

	listRow := stored.SpawnRow(false)
	if listRow.WithAppearTail {
		t.Fatal("the object-list row carries an appear tail")
	}
	if len(listRow.Encode())+1 != len(row.Encode()) {
		t.Fatalf("list row is %d bytes and the single-object row %d; want exactly one more",
			len(listRow.Encode()), len(row.Encode()))
	}
}

// Character names are matched case-insensitively, so the pending key must fold.
func TestPendingKeyFoldsTheCharacterName(t *testing.T) {
	if got, want := PendingKey("1", "ASD"), PendingKey("1", "asd"); got != want {
		t.Fatalf("PendingKey is case sensitive: %q vs %q", got, want)
	}
	if got, want := PendingKey("1", "asd"), "1:asd"; got != want {
		t.Fatalf("PendingKey = %q, want %q", got, want)
	}
	if PendingKey("1", "asd") == PendingKey("2", "asd") {
		t.Fatal("the same character in two divisions shares a pending key")
	}
}

func TestAllReturnsACopy(t *testing.T) {
	registry := NewRegistry()
	stored := registry.Add("1", testItem(11459))

	items := registry.All("1")
	items[0].RefObjID = 1

	fresh, ok := registry.Get("1", stored.Gid)
	if !ok {
		t.Fatal("the entry vanished")
	}
	if fresh.RefObjID != 11459 {
		t.Fatalf("mutating the All() result changed the registry: refObjId = %d", fresh.RefObjID)
	}
	if reflect.DeepEqual(items[0], fresh) {
		t.Fatal("All() handed back the stored value rather than a copy")
	}
}
