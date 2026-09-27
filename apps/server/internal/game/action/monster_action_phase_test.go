package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestMonsterPreAIPhaseLeavesPlayerSkillControlsForExistingOwner(t *testing.T) {
	rt, clock, character, actor := newCombatTestRuntime(t, 100)
	rt.queueSkillFinalize(testDivision, character.Name, enterworld.ObjectIDForCharacter(character), clock.NowMs(), wire.SkillCastFinalizeFrame(10))
	rt.queueSkillFinalize(testDivision, monsterCastOwner(actor.Gid), actor.Gid, clock.NowMs(), wire.SkillCastFinalizeFrame(20))
	before := rt.MonsterActionTickHook()(clock.NowMs())
	if len(before) != 1 || before[0].SourceGID != actor.Gid || len(rt.pendingSkillFinalizes) != 1 ||
		rt.pendingSkillFinalizes[0].characterName != character.Name {
		t.Fatal("monster phase consumed player control", before)
	}
	if got := rt.MonsterActionTickHook()(clock.NowMs()); len(got) != 0 {
		t.Fatal("duplicate monster control", got)
	}
	after := rt.TickHook()(clock.NowMs())
	if len(after) != 1 || after[0].SourceGID != enterworld.ObjectIDForCharacter(character) || len(rt.pendingSkillFinalizes) != 0 {
		t.Fatal("existing player control phase changed", after)
	}
}
