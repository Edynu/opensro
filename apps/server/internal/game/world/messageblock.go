package world

// MessageBlock identifies a native activity bucket. World/partition identity
// belongs to its caller. Dungeon grid coordinates are relative to the DOF
// navigation bounds, not outdoor region coordinates (99A520/99A600).
type MessageBlock struct {
	Region  uint16 // zero outdoors, where X/Z already include region coordinates
	X, Y, Z int
}

func OutdoorMessageBlock(position RegionXZ) (MessageBlock, bool) {
	if IsDungeonRegion(position.RegionID) {
		return MessageBlock{}, false
	}
	b := InterestBlockAt(position)
	return MessageBlock{X: b.X, Z: b.Z}, true
}

func (b MessageBlock) Neighbors() []MessageBlock {
	yMin, yMax := 0, 0
	if b.Region != 0 {
		yMin, yMax = -1, 1
	}
	out := make([]MessageBlock, 0, 27)
	for x := -1; x <= 1; x++ {
		for y := yMin; y <= yMax; y++ {
			for z := -1; z <= 1; z++ {
				out = append(out, MessageBlock{Region: b.Region, X: b.X + x, Y: b.Y + y, Z: b.Z + z})
			}
		}
	}
	return out
}
