package enterworld

// SkillMonsterSelfEffect is a complete, unlinked monster self-buff program.
// The self selector and ContinueBasicAttack column distinguish it from player
// timed effects. Admission still measures the enemy's body-contact radius.
type SkillMonsterSelfEffect struct {
	Pinned        bool
	Tag           uint32
	First, Second uint32
}

func parseSkillMonsterSelfEffect(fields []string, row *SkillRow) {
	if len(fields) != 118 || fields[0] != "1" || fields[8] != "2" || fields[68] != "3" ||
		fields[9] != "0" || fields[19] != "1" || fields[26] != "1" ||
		!row.ActionCastingTimePinned || !row.ActionDurationPinned || !row.TimingPinned ||
		!row.ActionRangePinned || !row.ReplacementPinned || row.CoolTimeMs == 0 ||
		!row.SpawnToken || row.SpawnStatus || row.EffectRider || !row.EffectDurationPresent || row.EffectDurationMs == 0 {
		return
	}
	// No implicit target domains, resource debits, projectiles or repeats.
	for _, col := range []int{16, 17, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32, 33, 52, 53, 54, 55, 56} {
		if fields[col] != "0" {
			return
		}
	}
	if fields[50] != "255" || fields[51] != "255" {
		return
	}
	program, err := CompileSkillProgram(fields)
	if err != nil || program.Len() != 2 {
		return
	}
	duration, effect := program.Instruction(0), program.Instruction(1)
	if duration.Tag != 0x64757261 || duration.Count != 1 || duration.Arguments[0] != row.EffectDurationMs {
		return
	}
	switch effect.Tag {
	case 0x64656670:
		if effect.Count != 3 || effect.Arguments[2] != 0 {
			return
		}
	case 0x6372, 0x647275:
		if effect.Count != 2 {
			return
		}
	default:
		return
	}
	row.MonsterSelfEffect = SkillMonsterSelfEffect{Pinned: true, Tag: effect.Tag, First: effect.Arguments[0], Second: effect.Arguments[1]}
}
