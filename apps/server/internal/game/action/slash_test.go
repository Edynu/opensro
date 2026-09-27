package action

import (
	"encoding/binary"
	"fmt"
	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestSlashCommitsAuthoredImpactAndSeparateAggression(t *testing.T) {
	rt, _, c, target := newCombatTestRuntime(t, 100000)
	skill := shippedOffense(t, "SKILL_EU_WARRIOR_ONEHANDA_STRIKE_A_01")
	if !skill.DirectOffensePinned || skill.Attack.ImpactCount != 1 || !skill.Threat.Present || skill.Threat.Flat != 149 || skill.Threat.Percent != 150 || skill.Attack.DownAttack.Percent != 150 {
		t.Fatalf("Slash admission: %+v", skill)
	}
	items := rt.deps.ItemReferences().(staticItemSource)
	for _, item := range items {
		item.TypeIDs[3] = 7
		c.MissionInventory[0].TypeFlags = item.TypeFlags()
	}
	rt.deps.SkillData().(staticSkillSource)[skill.ID] = skill
	c.Skills = append(c.Skills, skill.ID)
	c.CurrentMP = testInt64(100)
	result := rt.HandleTargetInteract(testDivision, c, wire.SkillAction{ActionId: skill.ID, HasTarget: true, TargetGid: target.Gid}.Encode())
	if len(result.Frames) == 0 || result.Frames[0].Opcode != wire.OpSkillCastResult || result.Frames[0].Payload[0] != 1 {
		t.Fatalf("Slash refused: %+v", result)
	}
	p := result.Frames[0].Payload
	if len(p) != 34 || p[19] != 1 || p[20] != 1 {
		t.Fatalf("impact matrix: %x", p)
	}
	// One target identity followed by its authored impact rows.
	var damage, threat uint32
	for _, offset := range []int{26} {
		d := binary.LittleEndian.Uint32(p[offset:]) >> 8
		damage += d
		threat = combat.AccumulateThreat(threat, d, skill.Threat)
	}
	after, _ := rt.Monsters.Get(testDivision, target.Gid)
	if target.CurrentHP-after.CurrentHP != damage || after.Opponents[0].Damage != damage || after.Opponents[0].Aggression != int32(threat) {
		t.Fatalf("HP/threat split: damage=%d threat=%d instance=%+v payload=%x", damage, threat, after, p)
	}
	if *c.CurrentMP != 89 {
		t.Fatalf("MP debited per hit: %d", *c.CurrentMP)
	}
	if after.Opponents[0].GID != enterworld.ObjectIDForCharacter(c) {
		t.Fatal("missing attacker identity")
	}
}

func TestEverySlashLevelReachesAuthority(t *testing.T) {
	for level := 1; level <= 22; level++ {
		t.Run(fmt.Sprint(level), func(t *testing.T) {
			rt, _, c, target := newCombatTestRuntime(t, 1000000)
			c.Level, c.MaxLevel = testInt64(100), testInt64(100)
			c.Intellect, c.Strength = testInt64(119), testInt64(119)
			skill := shippedOffense(t, fmt.Sprintf("SKILL_EU_WARRIOR_ONEHANDA_STRIKE_A_%02d", level))
			if !skill.DirectOffensePinned || !skill.Threat.Present || !skill.Attack.DownAttack.Present {
				t.Fatalf("incomplete admission: %+v", skill)
			}
			for _, item := range rt.deps.ItemReferences().(staticItemSource) {
				item.TypeIDs[3] = 7
				c.MissionInventory[0].TypeFlags = item.TypeFlags()
			}
			rt.deps.SkillData().(staticSkillSource)[skill.ID] = skill
			c.Skills = append(c.Skills, skill.ID)
			c.CurrentMP = testInt64(int64(skill.Consumption.MP))
			request := wire.SkillAction{ActionId: skill.ID, HasTarget: true, TargetGid: target.Gid}.Encode()
			result := rt.HandleTargetInteract(testDivision, c, request)
			if len(result.Frames) == 0 || result.Frames[0].Opcode != wire.OpSkillCastResult || result.Frames[0].Payload[0] != 1 {
				t.Fatalf("level %d refused: %+v", level, result)
			}
			after, _ := rt.Monsters.Get(testDivision, target.Gid)
			if after.CurrentHP >= target.CurrentHP || *c.CurrentMP != 0 || after.Opponents[0].Aggression <= int32(after.Opponents[0].Damage) {
				t.Fatalf("missing damage/cost/aggression: %+v", after)
			}
		})
	}
}
