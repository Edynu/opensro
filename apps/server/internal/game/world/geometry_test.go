package world

import "testing"

func TestAdjacentRegionDeltaDistanceAndInterpolationShareOneFrame(t *testing.T) {
	west := RegionIDForSectors(40, 50)
	east := RegionIDForSectors(41, 50)
	from := RegionXZ{RegionID: west, X: 1910, Z: 100}
	to := RegionXZ{RegionID: east, X: 10, Z: 100}

	dx, dz := Delta(from, to)
	if dx != 20 || dz != 0 || Distance(from, to) != 20 {
		t.Fatalf("adjacent seam delta=(%v,%v), distance=%v; want (20,0), 20", dx, dz, Distance(from, to))
	}
	mid := Interpolate(from, to, 0.5)
	if mid.RegionID != east || mid.X != 0 || mid.Z != 100 {
		t.Fatalf("adjacent seam midpoint=%+v, want east-region local (0,100)", mid)
	}
}

func TestNormalizeOutdoorCarriesBothAxesAndLeavesDungeonLocal(t *testing.T) {
	region := RegionIDForSectors(40, 50)
	got := NormalizeOutdoor(RegionXZ{RegionID: region, X: -5, Z: OutdoorRegionSize + 7})
	wantRegion := RegionIDForSectors(39, 51)
	if got.RegionID != wantRegion || got.X != OutdoorRegionSize-5 || got.Z != 7 {
		t.Fatalf("normalized outdoor=%+v, want region=%#04x x=%v z=7", got, wantRegion, OutdoorRegionSize-5)
	}

	dungeon := RegionXZ{RegionID: DungeonRegionBit | 7, X: 4000, Z: -300}
	if got := NormalizeOutdoor(dungeon); got != dungeon {
		t.Fatalf("dungeon normalization changed %+v to %+v", dungeon, got)
	}
}

func TestGridFrameRoundTripAcrossOutdoorSeam(t *testing.T) {
	west := RegionIDForSectors(50, 40)
	east := RegionIDForSectors(51, 40)
	grid := ExpandGrid(RegionXZ{RegionID: east, X: 10, Z: 25})
	inWest := LocalFromGrid(west, grid)
	if inWest.RegionID != west || inWest.X != OutdoorRegionSize+10 || inWest.Z != 25 {
		t.Fatalf("east point in west frame=%+v", inWest)
	}
	if roundTrip := ExpandGrid(inWest); roundTrip != grid {
		t.Fatalf("round trip=%+v, want %+v", roundTrip, grid)
	}
}

func TestSamePlaneRejectsOutdoorDungeonPair(t *testing.T) {
	if !SamePlane(0x3228, 0x3229) {
		t.Fatal("adjacent outdoor regions must share a plane")
	}
	if SamePlane(0x3228, 0x3228|DungeonRegionBit) {
		t.Fatal("outdoor and dungeon regions must not share a plane")
	}
}

func TestDungeonLiveInterpolationPreservesUnboundedLocalCoordinates(t *testing.T) {
	region := DungeonRegionBit | 7
	from := RegionXZ{RegionID: region, X: 3000, Z: -500}
	to := RegionXZ{RegionID: region, X: 5000, Z: 500}
	got := Interpolate(from, to, 0.5)
	if got.RegionID != region || got.X != 4000 || got.Z != 0 {
		t.Fatalf("dungeon midpoint=%+v, want region=%#04x local (4000,0)", got, region)
	}
}

func TestInterpolationClampsBeforeDepartureAndAfterArrival(t *testing.T) {
	from := RegionXZ{RegionID: 0x3230, X: 100, Z: 200}
	to := RegionXZ{RegionID: 0x3230, X: 300, Z: 400}
	if got := Interpolate(from, to, -0.5); got != from {
		t.Fatalf("pre-departure interpolation=%+v, want from=%+v", got, from)
	}
	if got := Interpolate(from, to, 1.5); got != to {
		t.Fatalf("post-arrival interpolation=%+v, want to=%+v", got, to)
	}
}
