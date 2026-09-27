package world

import "math"

// Native outdoor interest area. The v1.150 client never culls server objects,
// so the interest radius is server evidence (v1.188 SR_GameServer,
// machine-verified):
//
//   - CRgnTerrain 53A850 builds 36 CMsgBlockTerrain blocks (vector
//     constructor 53A8A1: count 0x24, stride 0x98).
//   - 53AD30 bounds local x and z by 1920.0 (qword 0xB45AD0), divides both by
//     320.0 (qword 0xB45AE8) and selects block (z/320)*6 + x/320.
//   - 53AB90 registers the eight neighbours at C64090, (-1,-1)..(1,1) without
//     (0,0), through 53AC20, which steps one region across a seam.
//   - Admission 534340 and removal 5344B0 notify that neighbour list and the
//     block itself; an adjacent transfer notifies only the per-neighbour
//     difference list keyed at block+0x1C (5336E0).
//
// An object is therefore visible exactly when its block lies in the 3x3 block
// neighbourhood of the viewer's block.
const (
	// InterestBlockSize is one CMsgBlockTerrain edge in world units.
	InterestBlockSize = 320.0
	// InterestBlocksPerRegion is the per-axis block count of one outdoor region.
	InterestBlocksPerRegion = 6
)

// InterestBlock is one native message block. Outdoor blocks are addressed in
// the continuous block grid (sector*6 + local/320), which removes region seams
// from neighbour arithmetic the way 53AC20 does.
//
// Dungeon regions use CRgnObject with per-cell CMsgBlockObject blocks
// (5374A0 matches an object cell id against the block id); those cell and link
// rules are not recovered, so a dungeon region remains one interest block.
type InterestBlock struct {
	// Dungeon is the dungeon region word; zero for outdoor blocks.
	Dungeon uint16
	// X and Z are continuous outdoor block-grid coordinates.
	X, Z int
}

// InterestBlockAt returns the message block containing position.
func InterestBlockAt(position RegionXZ) InterestBlock {
	if IsDungeonRegion(position.RegionID) {
		return InterestBlock{Dungeon: position.RegionID}
	}
	grid := ExpandGrid(position)
	return InterestBlock{
		X: int(math.Floor(grid.X / InterestBlockSize)),
		Z: int(math.Floor(grid.Z / InterestBlockSize)),
	}
}

// Adjacent reports whether other is block or one of its eight neighbours.
func (block InterestBlock) Adjacent(other InterestBlock) bool {
	if block.Dungeon != 0 || other.Dungeon != 0 {
		return block.Dungeon == other.Dungeon
	}
	return abs(block.X-other.X) <= 1 && abs(block.Z-other.Z) <= 1
}

// InterestVisible reports whether an object at object is inside the native
// interest area of a viewer at viewer. The relation is symmetric.
func InterestVisible(viewer, object RegionXZ) bool {
	return InterestBlockAt(viewer).Adjacent(InterestBlockAt(object))
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
