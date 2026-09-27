package wire

// SkillAreaTarget is one committed victim of an area cast: one record per
// authored impact, in impact order.
type SkillAreaTarget struct {
	GID     uint32
	Impacts []SkillCastTargetImpact
}

// SkillCastAreaFrame follows client 8e0190: impact count, target count, then
// each target's gid and its impact rows. One cast token owns every victim,
// and every victim carries the same number of records.
func SkillCastAreaFrame(cast SkillCastSuccess, primary uint32, targets []SkillAreaTarget) Frame {
	if len(targets) == 0 || len(targets) > 255 || targets[0].GID != primary {
		panic("wire: invalid area target set")
	}
	impacts := len(targets[0].Impacts)
	for _, target := range targets {
		if len(target.Impacts) != impacts || impacts == 0 || impacts > 255 {
			panic("wire: invalid area impact set")
		}
	}
	cast.OwnerOrTargetGid = primary
	w := cast.writePrefix(NewWriter(21 + (4+9*impacts)*len(targets))).U8(skillCastSteeringTargets).U8(uint8(impacts)).U8(uint8(len(targets)))
	for _, target := range targets {
		w.U32(target.GID)
		for _, impact := range target.Impacts {
			impact.writeTo(w)
		}
	}
	return Frame{Opcode: OpSkillCastResult, Payload: w.Payload()}
}

// Area release retains the original action token and the shared result grammar.
func SkillCastAreaReleaseFrame(cast SkillCastSuccess, primary uint32, targets []SkillAreaTarget) Frame {
	start := SkillCastAreaFrame(cast, primary, targets)
	return Frame{Opcode: OpSkillEffectControl, Payload: append(NewWriter(5).U8(1).U32(cast.InstanceToken).Payload(), start.Payload[14:]...)}
}
