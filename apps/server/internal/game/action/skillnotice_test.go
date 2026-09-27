package action

import (
	"bytes"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestMPShortageAtAdmissionAndCommitPublishesOnlyWarning(t *testing.T) {
	for _, area := range []bool{false, true} {
		for _, atCommit := range []bool{false, true} {
			rt, _, c, target := newCombatTestRuntime(t, 100000)
			code := "SKILL_CH_SWORD_SMASH_A_01"
			if area {
				rt, _ = areaFixture(t, 100000)
				c = rt.findCharacter(testDivision, "asd2")
				code = "SKILL_CH_LIGHTNING_CHUNDUNG_A_01"
			}
			skill := shippedOffense(t, code)
			rt.deps.SkillData().(staticSkillSource)[skill.ID] = skill
			c.Skills = append(c.Skills, skill.ID)
			c.CurrentMP = testInt64(0)
			if atCommit {
				c.CurrentMP = testInt64(1000)
				rt.deps.(*enterworld.Deps).UpdateCharacters = func(_ []*enterworld.Character, reason string, update func() bool) bool {
					c.CurrentMP = testInt64(0)
					return update()
				}
			}
			before, _ := rt.Monsters.Get(testDivision, target.Gid)
			result := rt.HandleTargetInteract(testDivision, c, wire.SkillAction{ActionId: skill.ID, HasTarget: true, TargetGid: target.Gid}.Encode())
			expectedTokens := uint32(0)
			if atCommit && skill.ActionCastingTimeMs > 0 {
				expectedTokens = 1
				released := releasePreparedSkillForTest(t, rt, rt.Now().UnixMilli()+int64(skill.ActionCastingTimeMs)+1)
				if len(released.Broadcast) != 1 || released.Broadcast[0].Payload[0] != 2 {
					t.Fatal("refused release did not close preparation")
				}
				result.Frames = released.ActorPrivate
			}
			if len(result.Frames) != 1 || result.Frames[0].Opcode != wire.OpSkillCastResult || !bytes.Equal(result.Frames[0].Payload, []byte{2, 4}) {
				t.Fatalf("area=%v commit=%v: %+v", area, atCommit, result)
			}
			after, _ := rt.Monsters.Get(testDivision, target.Gid)
			if after.CurrentHP != before.CurrentHP || *c.CurrentMP != 0 || rt.castTokenCounter != expectedTokens || len(c.OffensiveSkillCooldowns) != int(expectedTokens) || (!atCommit && len(result.Broadcast) != 0) {
				t.Fatal("refusal changed combat authority")
			}
		}
	}
}

func TestUnsupportedReleasePublishesNoticeAndClosesWithoutSpending(t *testing.T) {
	rt, clock, c, target := newCombatTestRuntime(t, 100000)
	skill := shippedOffense(t, "SKILL_CH_SWORD_SMASH_A_01")
	rows := rt.deps.SkillData().(staticSkillSource)
	rows[skill.ID] = skill
	c.Skills = append(c.Skills, skill.ID)
	c.CurrentMP = testInt64(1000)
	rt.HandleTargetInteract(testDivision, c, wire.SkillAction{ActionId: skill.ID, HasTarget: true, TargetGid: target.Gid}.Encode())
	skill.OffensiveStagePinned = false
	skill.DirectOffensePinned = false
	rows[skill.ID] = skill
	released := releasePreparedSkillForTest(t, rt, clock.NowMs()+int64(skill.ActionCastingTimeMs)+1)
	if len(released.Broadcast) != 1 || released.Broadcast[0].Payload[0] != 2 {
		t.Fatal("preparation not closed")
	}
	if len(released.ActorPrivate) != 1 || released.ActorPrivate[0].Opcode != 0x3667 || released.ActorPrivate[0].Payload[0] != 7 {
		t.Fatalf("missing visible refusal: %+v", released)
	}
	after, _ := rt.Monsters.Get(testDivision, target.Gid)
	if after.CurrentHP != target.CurrentHP || *c.CurrentMP != 1000 || c.OffensiveSkillCooldowns[skill.Group] != clock.NowMs()+int64(skill.CoolTimeMs) {
		t.Fatal("unsupported release spent resources")
	}
}
