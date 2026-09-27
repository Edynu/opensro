package quest

import (
	"fmt"
	"opensro.online/server/internal/game/enterworld"
)

func prerequisitesMet(c *enterworld.Character, def *Definition) bool {
	if def.AcceptanceUnavailable != "" {
		return false
	}
	for _, id := range def.RequiredQuestIDs {
		if !questCompleted(c, id) {
			return false
		}
	}
	return true
}

// Dependencies are checked at load time, not recursively on each NPC click.
func validateQuestChains(defs *Definitions) error {
	visited := map[uint32]uint8{}
	var visit func(*Definition) error
	visit = func(def *Definition) error {
		if visited[def.RefID] == 1 {
			return fmt.Errorf("cyclic quest dependency at %s", def.Codename)
		}
		if visited[def.RefID] == 2 {
			return nil
		}
		visited[def.RefID] = 1
		for _, id := range def.RequiredQuestIDs {
			parent, ok := defs.ByRefID(id)
			if !ok {
				if defs.externalPrerequisites[id] {
					continue
				}
				return fmt.Errorf("missing predecessor %d", id)
			}
			if err := visit(parent); err != nil {
				return err
			}
		}
		visited[def.RefID] = 2
		return nil
	}
	for _, def := range defs.All() {
		if err := visit(def); err != nil {
			return err
		}
	}
	return nil
}
