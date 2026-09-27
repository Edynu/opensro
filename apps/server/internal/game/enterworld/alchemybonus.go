package enterworld

// 587E1F/588A97 index one-value alcu/luck blocks; 596382/5963B5
// add their unsigned value to AC/AD. These tags have no payload collisions
// in the published v1.150 skill rows. Begin at the primary block (69), since
// premium/passive rows do not necessarily contain an attack block.
func encodedAlchemyBonus(fields []string, tag int64) uint32 {
	for i := skilldataColPrimaryTag; i+1 < len(fields); i++ {
		v, ok := textdataInt(fields[i])
		if ok && v == tag {
			return textdataU32(fields[i+1])
		}
	}
	return 0
}
