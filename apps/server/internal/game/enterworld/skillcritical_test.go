package enterworld

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func criticalFields(tail ...string) []string {
	fields := make([]string, 69)
	for i := range fields {
		fields[i] = "0"
	}
	return append(fields, tail...)
}

func TestCriticalParameterFraming(t *testing.T) {
	for _, tc := range []struct {
		name  string
		tail  []string
		want  SkillCriticalModifier
		valid bool
	}{
		{"absent", []string{"0"}, SkillCriticalModifier{}, true},
		{"pair", []string{"25458", "20", "0", "0"}, SkillCriticalModifier{true, 20, 0}, true},
		{"tag in argument", []string{"6386804", "4", "25458", "0", "0", "0", "0"}, SkillCriticalModifier{}, true},
		{"ssou ends stream", []string{"1936945013", "25458", "20", "0"}, SkillCriticalModifier{}, true},
		{"zero padding advances one word", []string{"0", "25458", "20", "0"}, SkillCriticalModifier{true, 20, 0}, true},
		{"native duplicate last wins", []string{"25458", "20", "0", "25458", "5", "100", "0"}, SkillCriticalModifier{true, 5, 100}, true},
		{"unsigned words", []string{"25458", "4294967295", "4294967295"}, SkillCriticalModifier{true, 0xffffffff, 0xffffffff}, true},
		{"truncated", []string{"25458", "20"}, SkillCriticalModifier{}, false},
		{"negative", []string{"25458", "-1", "0"}, SkillCriticalModifier{}, false},
		{"overflow", []string{"25458", "0", "4294967296"}, SkillCriticalModifier{}, false},
		{"invalid", []string{"25458", "no", "0"}, SkillCriticalModifier{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, valid := encodedCriticalModifier(criticalFields(tc.tail...))
			if got != tc.want || valid != tc.valid {
				t.Fatalf("%+v %v, want %+v %v", got, valid, tc.want, tc.valid)
			}
		})
	}
}

func TestCriticalModifierLoaderAndOffensiveAdmission(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "skilldata.txt"), []byte("skills.txt\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var lines []string
	for id := 1; id <= 5; id++ {
		fields := make([]string, 118)
		for i := range fields {
			fields[i] = "0"
		}
		for i, v := range map[int]string{0: "1", 1: strconv.Itoa(id), 2: "7", 3: "CR_TEST_" + strconv.Itoa(id), 13: "1000", 14: "3000", 22: "1", 50: "3", 51: "255", 21: "30"} {
			fields[i] = v
		}
		copy(fields[69:], []string{"6386804", "4", "100", "10", "20", "100", "25458", "20", "0", "0"})
		if id == 2 {
			fields[76] = "bad"
		}
		if id == 3 {
			copy(fields[78:], []string{"25458", "5", "0"})
		}
		if id == 4 {
			copy(fields[78:], []string{"27490", "1", "100"})
		} // knockback is now a complete executable companion
		if id == 5 {
			copy(fields[69:], []string{"25458", "20", "0", "0", "0", "0", "0", "0", "0", "0"})
		}
		lines = append(lines, strings.Join(fields, "\t"))
	}
	if err := os.WriteFile(filepath.Join(dir, "skills.txt"), []byte(strings.Join(lines, "\n")), 0600); err != nil {
		t.Fatal(err)
	}
	skills := NewTextdataSkills(dir)
	for id := uint32(1); id <= 5; id++ {
		row, ok := skills.SkillByID(id)
		if !ok {
			t.Fatalf("lost catalog row %d", id)
		}
		if row.DirectOffensePinned != (id == 1 || id == 4) {
			t.Fatalf("row %d admission: %+v", id, row)
		}
		if id == 2 && (row.CombatPinned || row.Attack.Present) {
			t.Fatal("malformed cr became unmodified attack")
		}
		if id == 5 && row.Attack.Present {
			t.Fatal("passive cr became attack")
		}
	}
}

func TestShippedCriticalModifiersRetainedWithoutOpeningUnsupportedEffects(t *testing.T) {
	skills := sharedShippedSkills(t)
	for _, tc := range []struct {
		name   string
		flat   uint32
		attack bool
	}{
		{"SKILL_CH_BOW_CRITICAL_A_01", 20, true},
		{"MSKILL_QT_01_HUNARCHER_CLON_ATTACK01", 10, true},
		{"SKILL_EU_WARRIOR_TWOHANDP_CRITICALUP_A_01", 2, false},
	} {
		row, ok := skills.SkillByCodename(tc.name)
		if !ok || row.CriticalModifier != (SkillCriticalModifier{true, tc.flat, 0}) || row.Attack.Present != tc.attack {
			t.Fatalf("%s: %+v", tc.name, row)
		}
		if row.DirectOffensePinned != (tc.name == "SKILL_CH_BOW_CRITICAL_A_01") {
			t.Fatalf("unsupported companion blocks admitted: %s", tc.name)
		}
	}
}
