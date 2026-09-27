package quest

import "opensro.online/server/internal/game/enterworld"

// TravelBlocks derives the shared mask from the authoritative active journal.
// There is no second persisted/cache owner to become stale after reconnect,
// abandonment, completion or overlapping restricted quests. Native 571f10
// recomputes active blocks; 4ddd10/20/30 own set/clear/query of +217c.
// Definition policy comes from primary quest requirements, separately from
// the later server's mask consumers (return 20000, gate 40000).
func (rt *Runtime) TravelBlocks(c *enterworld.Character) uint32 {
	if c == nil {
		return 0
	}
	var mask uint32
	for _, record := range c.ActiveQuests {
		if def, ok := rt.Defs.ByRefID(record.RefID); ok {
			mask |= def.TravelBlockMask
		}
	}
	return mask
}
