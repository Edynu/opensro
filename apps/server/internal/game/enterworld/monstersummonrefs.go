package enterworld

import (
	"fmt"
	"opensro.online/server/internal/game/world/monster"
	"sort"
)

// Compute the reference closure before network admission. Summoned creatures
// can lack npcpos nests; omitting them from the initial mirror makes a valid
// subsequent spawn disappear in the native client.
func withMonsterSummonReferences(template monster.Template, skills SkillDataSource) (monster.Template, error) {
	seen := map[uint32]bool{}
	var pending []uint32
	for id, ref := range template.Refs {
		if monster.UniqueSummonPolicy(ref.Codename) != monster.NoSummonPolicy {
			seen[id] = true
			pending = append(pending, id)
		}
	}
	if len(pending) > 0 && skills == nil {
		return template, fmt.Errorf("unique encounter roster requires skill data")
	}
	for i := 0; i < len(pending); i++ {
		ref := template.Refs[pending[i]]
		for _, id := range ref.DefaultSkillIDs {
			if id == 0 {
				continue
			}
			skill, ok := skills.SkillByID(id)
			if !ok {
				return template, fmt.Errorf("monster %s has missing default skill %d", ref.Codename, id)
			}
			if !skill.Summon.Present {
				continue
			}
			for _, entry := range skill.Summon.Entries {
				if entry.RefObjID == 0 {
					continue
				}
				if _, ok := template.Refs[entry.RefObjID]; !ok {
					return template, fmt.Errorf("monster %s summon %d has missing reference %d", ref.Codename, id, entry.RefObjID)
				}
				if !seen[entry.RefObjID] {
					seen[entry.RefObjID] = true
					pending = append(pending, entry.RefObjID)
				}
			}
		}
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i] < pending[j] })
	template.SummonRefs = pending
	return template, nil
}
