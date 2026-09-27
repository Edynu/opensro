package quest

import "opensro.online/server/internal/game/enterworld"

func completionCount(c *enterworld.Character, id uint32) uint32 {
	count := c.QuestCompletionCounts[id]
	if count == 0 && questCompleted(c, id) {
		return 1
	}
	return count
}

func canAcceptAgain(c *enterworld.Character, def *Definition) bool {
	if def.Repeatable {
		return true
	}
	return completionCount(c, def.RefID) < max(1, def.MaxCompletions)
}

func recordCompletion(c *enterworld.Character, id uint32) {
	count := completionCount(c, id)
	if c.QuestCompletionCounts == nil {
		c.QuestCompletionCounts = make(map[uint32]uint32)
	}
	if count < ^uint32(0) {
		count++
	}
	c.QuestCompletionCounts[id] = count
}

// v1.150 5c4087..5c40d7 formats the low nibble first (current run),
// then the high nibble (limit). The old unlimited exchange keeps zero.
func repeatTitleByte(def *Definition, completed uint32) uint8 {
	if def.Repeatable {
		return 0
	}
	limit := min(uint32(15), max(uint32(1), def.MaxCompletions))
	return uint8(limit<<4 | min(limit, completed+1))
}
