/*
===========================================================================

skillcurse_test.go - curse skill admission

===========================================================================
*/

package enterworld

import (
	"strconv"
	"testing"

	"opensro.online/server/internal/game/abnormal"
)

func TestCurseAdmissionRequiresCompleteAttackProgram(t *testing.T) {
	for _, mode := range []string{"valid", "negative", "grade-overflow", "duplicate", "unknown", "no-attack"} {
		fields := make([]string, 118)
		for i := range fields {
			fields[i] = "0"
		}
		fields[0] = "1"
		fields[69] = strconv.FormatInt(skillAttackTag, 10)
		copy(fields[70:], []string{"5", "100", "10", "20", "100", "1668510578", "30000", "20", "8", "35"})
		row := SkillRow{CombatPinned: true, TimingPinned: true, ActionRangePinned: true, TargetRequired: true}
		switch mode {
		case "negative":
			fields[79] = "-1"
		case "grade-overflow":
			fields[78] = "256"
		case "duplicate":
			copy(fields[80:], fields[75:80])
		case "unknown":
			fields[80] = "999999"
		case "no-attack":
			copy(fields[69:], fields[75:80])
			for i := 74; i < 80; i++ {
				fields[i] = "0"
			}
		}
		row.Abnormal = encodedAbnormalParams(fields)
		parseSkillOffense(fields, &row)
		if row.OffensiveStagePinned != (mode == "valid") {
			t.Fatalf("%s admission=%v refusal=%s", mode, row.OffensiveStagePinned, row.OffenseRefusal)
		}
		if mode == "valid" {
			curse, present := row.Abnormal.Param(abnormal.Impotent)
			if !present || curse.Args[0] != 30000 || curse.Args[1] != 20 || curse.Args[2] != 8 || curse.Args[3] != 35 || compactSkill(row).value().Abnormal != row.Abnormal {
				t.Fatal("resident descriptor lost", row.Abnormal)
			}
		}
	}
}
