package simulation

import "math"

// npcpos has no heading. Recover only unchanged placements from later server
// nests, using the same float32/tenth normalization as population evidence.
// A moved or renamed NPC does not inherit a guessed nearest-neighbour heading.
type npcHeadingKey struct {
	Codename      string
	Region        uint16
	X10, Y10, Z10 int64
}

func npcPlacementHeading(code string, region uint16, x, y, z float64) (uint16, bool) {
	tenth := func(v float64) int64 { return int64(math.Round(float64(float32(v)) * 10)) }
	heading, found := recoveredNPCHeadings[npcHeadingKey{code, region, tenth(x), tenth(y), tenth(z)}]
	return heading, found
}
