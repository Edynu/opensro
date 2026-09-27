package enterworld

import (
	"os"
	"reflect"
	"testing"
)

func TestExecutionPlansMatchCompleteProductionAdmission(t *testing.T) {
	dir := os.Getenv("SRO_SKILL_INVENTORY_DATA")
	if dir == "" {
		t.Skip("set SRO_SKILL_INVENTORY_DATA for exhaustive published-row validation")
	}
	source := NewTextdataSkills(dir)
	if err := source.Load(); err != nil {
		t.Fatal(err)
	}
	rows := source.rows
	for id, row := range source.rows.values() {
		plan := source.ExecutionPlan(id)
		sequence, ok := validateOffensiveSequence(rows, id)
		if (plan.Kind() == SkillExecutionOffense) != ok {
			t.Fatalf("admission drift for %d", id)
		}
		if ok && !reflect.DeepEqual(sequence, plan.stages) {
			t.Fatalf("stage descriptors changed for %d", id)
		}
		if row.ChainSub && plan.Kind() != SkillExecutionUnsupported {
			t.Fatalf("child %d admitted as root", id)
		}
		if plan.Len() > 0 {
			copy := plan.Stage(0)
			copy.ID = 0
			if plan.Stage(0).ID != id {
				t.Fatalf("mutable plan escaped for %d", id)
			}
		}
		if ok {
			copied, _ := OffensiveSequence(source, id)
			copied[0].ID = 0
			if source.ExecutionPlan(id).Stage(0).ID != id {
				t.Fatal("legacy sequence returned writable storage")
			}
		}
	}
}

func TestExecutionPlanRejectsMixedAndBrokenChains(t *testing.T) {
	root := SkillRow{ID: 1, Group: 1, Level: 1, InstantSelfEffectPinned: true, ChainNext: 2}
	rows := skillPlanRows{1: root, 2: {ID: 2, Group: 1, Level: 1, ChainSub: true}}
	if p := compileExecutionPlan(rows, root); p.Kind() != SkillExecutionUnsupported {
		t.Fatal("partial self effect admitted before unsupported child")
	}
	root.ChainNext = 0
	rows[1] = root
	if p := compileExecutionPlan(rows, root); p.Kind() != SkillExecutionInstantEffect || p.Len() != 1 {
		t.Fatal("complete existing route lost")
	}
	root.ChainSub = true
	if p := compileExecutionPlan(rows, root); p.Len() != 0 {
		t.Fatal("substage admitted independently")
	}
}
