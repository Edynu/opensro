package enterworld

// SkillPositionEffect describes a complete ground-targeted tele program.
// Server 586460 reads argument 1 as range; 586473 selects travel bit 8.
// Argument 0 is retained without treating it as Action_ActionDuration.
type SkillPositionEffect struct {
	Pinned           bool
	Parameter, Range uint32
}

func decodeSkillPosition(fields []string, row SkillRow) SkillPositionEffect {
	p, err := CompileSkillProgram(fields)
	if err != nil || p.Len() != 1 || !row.TimingPinned || !row.Consumption.Pinned ||
		!row.TargetRequired || row.ChainSub || row.ChainNext != 0 ||
		row.ActionCastingTimeMs != 0 || row.ActionDurationMs != 0 ||
		row.Consumption.HP != 0 || row.Consumption.HPPercent != 0 ||
		fields[0] != "1" || fields[15] != "0" || fields[17] != "0" || fields[56] != "0" {
		return SkillPositionEffect{}
	}
	i := p.Instruction(0)
	if i.Tag != 0x74656c65 || i.Count != 2 || i.Arguments[1] == 0 || i.Arguments[1] > 0x7fffffff {
		return SkillPositionEffect{}
	}
	return SkillPositionEffect{Pinned: true, Parameter: i.Arguments[0], Range: i.Arguments[1]}
}
