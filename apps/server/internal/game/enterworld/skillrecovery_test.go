package enterworld

import "testing"

func TestRecoveryAdmissionRequiresCompleteUnmodifiedProgram(t *testing.T) {
	fields := make([]string, 118)
	for i := range fields {
		fields[i] = "0"
	}
	fields[0] = "1"
	fields[8] = "2"
	fields[69] = "1751474540"
	fields[70] = "89"
	base := SkillRow{Consumption: SkillConsumption{Pinned: true}, TimingPinned: true, ActionCastingTimePinned: true, ActionDurationMs: 1000, ActionDurationPinned: true}
	row := base
	parseSkillRecovery(fields, &row)
	if !row.Recovery.SelfFlatPinned {
		t.Fatal("baseline refused")
	}
	for _, mutation := range []struct {
		column int
		value  string
	}{{8, "0"}, {15, "1"}, {22, "1"}, {33, "1"}, {56, "1"}, {71, "50"}, {70, "-1"}, {74, "1886743667"}, {117, "1"}} {
		changed := append([]string(nil), fields...)
		changed[mutation.column] = mutation.value
		row = base
		parseSkillRecovery(changed, &row)
		if row.Recovery.SelfFlatPinned {
			t.Fatalf("column %d was silently ignored", mutation.column)
		}
	}
	row = base
	row.ChainNext = 9
	parseSkillRecovery(fields, &row)
	if row.Recovery.SelfFlatPinned {
		t.Fatal("chain was reduced to self-heal")
	}
}

func TestRecoveryProgramCannotDropAdditionalEffects(t *testing.T) {
	source := sharedShippedSkills(t)
	count := 0
	for _, ref := range source.SpawnSkillRows() {
		row, _ := source.SkillByID(ref.ID)
		if row.Recovery.SelfFlatPinned {
			count++
		}
	}
	t.Logf("Complete flat self-recovery rows: %d", count)
	for _, name := range []string{"SKILL_CH_WATER_SELFHEAL_A_01", "SKILL_CH_WATER_SELFHEAL_D_01"} {
		row, ok := source.SkillByCodename(name)
		if !ok || !row.Recovery.SelfFlatPinned {
			t.Fatalf("flat self recovery missing: %s", name)
		}
	}
	for _, name := range []string{"SKILL_CH_WATER_HEAL_A_01", "SKILL_CH_WATER_RESURRECTION_A_01", "SKILL_EU_CLERIC_HEALA_CYCLE_A_01", "SKILL_EU_CLERIC_HEALA_GROUP_A_01", "SKILL_EU_BARD_RECOVERA_ABNORMALTIME_A_01"} {
		row, ok := source.SkillByCodename(name)
		if !ok || row.Recovery.SelfFlatPinned {
			t.Fatalf("compound recovery reduced to self heal: %s", name)
		}
	}
}
