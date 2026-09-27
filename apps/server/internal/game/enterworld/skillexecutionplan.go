package enterworld

// SkillExecutionKind names an existing authority route, not an effect opcode.
// A decoded operation is never sufficient to grant a route admission.
type SkillExecutionKind uint8

const (
	SkillExecutionUnsupported SkillExecutionKind = iota
	SkillExecutionOffense
	SkillExecutionRecovery
	SkillExecutionInstantEffect
	SkillExecutionPassive
	SkillExecutionTimedEffect
	SkillExecutionPosition
)

// SkillExecutionPlan is immutable after table publication. Each stage carries
// the shared targeting, cost, timing, damage and effect descriptors already
// validated by its native-shape compiler. Runtime state stays in action owners.
type SkillExecutionPlan struct {
	source *skillStorage
	ids    []uint32
	kind   SkillExecutionKind
	stages []residentSkill
}

func (p SkillExecutionPlan) Kind() SkillExecutionKind { return p.kind }
func (p SkillExecutionPlan) Len() int {
	if p.source != nil {
		return len(p.ids)
	}
	return len(p.stages)
}
func (p SkillExecutionPlan) Stage(i int) SkillRow {
	if p.source != nil {
		return p.source.get(p.ids[i])
	}
	return p.stages[i].value()
}

type skillPlanRows map[uint32]SkillRow

func (s skillPlanRows) SkillByID(id uint32) (SkillRow, bool) { r, ok := s[id]; return r, ok }
func (s skillPlanRows) SkillByCodename(name string) (SkillRow, bool) {
	for _, r := range s {
		if r.Codename == name {
			return r, true
		}
	}
	return SkillRow{}, false
}

func compileExecutionPlan(source SkillDataSource, root SkillRow) SkillExecutionPlan {
	if root.ChainSub {
		return SkillExecutionPlan{}
	}
	if stages, ok := validateOffensiveSequence(source, root.ID); ok {
		return SkillExecutionPlan{kind: SkillExecutionOffense, stages: compactSkillStages(stages)}
	}
	// Existing self/passive compilers reject linked programs. Preserve that
	// complete-program restriction until a mixed-stage authority is verified.
	if root.ChainNext != 0 {
		return SkillExecutionPlan{}
	}
	kind := SkillExecutionUnsupported
	switch {
	case root.PositionEffect.Pinned:
		kind = SkillExecutionPosition
	case root.Recovery.SelfFlatPinned:
		kind = SkillExecutionRecovery
	case root.InstantSelfEffectPinned || root.Imbue.Pinned:
		kind = SkillExecutionInstantEffect
	case root.TimedEffect.Pinned && !root.TimedEffect.Persistent:
		kind = SkillExecutionTimedEffect
	case root.PassiveParameters.Pinned || root.PassiveCritical.Pinned || root.PassiveDefense.Pinned:
		kind = SkillExecutionPassive
	}
	if kind == SkillExecutionUnsupported {
		return SkillExecutionPlan{}
	}
	return SkillExecutionPlan{kind: kind, stages: []residentSkill{compactSkill(root)}}
}

// ExecutionPlan returns a value backed by private, immutable table storage.
func (t *TextdataSkills) ExecutionPlan(id uint32) SkillExecutionPlan {
	t.once.Do(t.load)
	return t.plans[id]
}

func compactSkillStages(rows []SkillRow) []residentSkill {
	out := make([]residentSkill, len(rows))
	for i, row := range rows {
		out[i] = compactSkill(row)
	}
	return out
}
