package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/statuseffect"
)

// Untargeted, unlinked validation calls 59D870 at 58E2F4; refusal is 300C.
// Caller holds the character authority and division operation doors. This is
// the validation phase, not the later effect insertion or timed-job restore.
func (rt *Runtime) requestSelfEffectReplacement(division string, c *enterworld.Character, skill enterworld.SkillRow) bool {
	if !skill.ReplacementPinned || skill.Replacement.Lnks {
		return false
	}
	descriptors := map[uint32]statuseffect.ReplacementDescriptor{skill.ID: skill.Replacement}
	for _, old := range rt.effects.Snapshot(division, c.Name) {
		row, ok := rt.deps.SkillData().SkillByID(old.SkillID)
		if !ok || !row.ReplacementPinned {
			return false
		}
		descriptors[row.ID] = row.Replacement
	}
	application := statuseffect.ReplacementApplication{
		Effect:      statuseffect.Effect{DivisionID: division, CharacterName: c.Name, SkillID: skill.ID, SkillGroup: skill.Group},
		Descriptors: descriptors, CasterIsRecipient: true,
	}
	if current, exists := rt.currentSkillCommandFor(division, c); exists {
		if !current.pinned {
			return false
		}
		application.CurrentPacked = current.descriptor.PackedStates
		if current.descriptor.Ovl2Present {
			application.CurrentOvl2 = current.descriptor.Ovl2
		}
	}
	return rt.effects.RequestReplacement(application)
}
