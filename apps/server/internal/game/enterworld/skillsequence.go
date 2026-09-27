package enterworld

// OffensiveSequence validates the whole authored graph before the first debit.
// v1.150 column 9 links skill records, not impact rows. Missing links, cycles,
// foreign groups/levels and unsupported later effects cannot become partial casts.
// The bound is an input-admission limit, not a truncation of a longer sequence.
func OffensiveSequence(source SkillDataSource, rootID uint32) ([]SkillRow, bool) {
	if compiled, ok := source.(interface {
		ExecutionPlan(uint32) SkillExecutionPlan
	}); ok {
		plan := compiled.ExecutionPlan(rootID)
		if plan.Kind() != SkillExecutionOffense {
			return nil, false
		}
		rows := make([]SkillRow, plan.Len())
		for i := range rows {
			rows[i] = plan.Stage(i)
		}
		return rows, true
	}
	return validateOffensiveSequence(source, rootID)
}

func validateOffensiveSequence(source SkillDataSource, rootID uint32) ([]SkillRow, bool) {
	if source == nil {
		return nil, false
	}
	root, ok := source.SkillByID(rootID)
	if !ok || root.ChainSub {
		return nil, false
	}
	seen := map[uint32]bool{}
	var sequence []SkillRow
	row := root
	for len(sequence) < 32 {
		if seen[row.ID] || row.Group != root.Group || row.Level != root.Level ||
			(!row.OffensiveStagePinned && !(row.DirectOffensePinned && row.ChainNext == 0)) {
			return nil, false
		}
		lifetime, valid := row.ActionLifecycleMs()
		if !valid || lifetime == 0 {
			return nil, false
		}
		if len(sequence) > 0 && (!row.ChainSub || row.Consumption.HP != 0 || row.Consumption.MP != 0 ||
			row.Consumption.HPPercent != 0 || row.Consumption.MPPercent != 0 || !row.Consumption.Pinned) {
			return nil, false
		}
		seen[row.ID] = true
		sequence = append(sequence, row)
		if row.ChainNext == 0 {
			return sequence, true
		}
		row, ok = source.SkillByID(row.ChainNext)
		if !ok {
			return nil, false
		}
	}
	return nil, false
}
