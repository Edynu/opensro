package guild_test

import (
	"opensro.online/server/internal/game/enterworld"
)

// guildSkillSeeder is this suite's stand-in for
// enterworld.DefaultSkillSeeder (the store's unconditional creation-seed
// invariant refuses an unseeded CreateCharacter): the same racial id
// sets the bootstrap door_persistence suite uses, without a textdata
// dependency. Guild tests never read skills - the seeder exists only
// to satisfy the store's creation invariant.
func guildSkillSeeder(raceKey string, learned []uint32) ([]uint32, error) {
	ids := []uint32{1, 7127, 7128, 7129, 7909, 7910, 8454, 9069, 9606, 9970}
	if raceKey == enterworld.RaceKeyChina {
		ids = []uint32{1, 2, 40, 70}
	}
	have := make(map[uint32]bool, len(learned))
	for _, id := range learned {
		have[id] = true
	}
	missing := make([]uint32, 0, len(ids))
	for _, id := range ids {
		if !have[id] {
			missing = append(missing, id)
		}
	}
	return missing, nil
}
