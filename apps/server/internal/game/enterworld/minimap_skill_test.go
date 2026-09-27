package enterworld

import (
	"strconv"
	"testing"
)

func TestMinimapSkillTagsAndDurationBranches(t *testing.T) {
	fields := make([]string, 118)
	for i := range fields {
		fields[i] = "0"
	}
	fields[69] = strconv.Itoa(0x617474)
	fields[70] = strconv.Itoa(0x686e7470)
	if encodedTailContainsTag(fields, 0x686e7470) {
		t.Fatal("attack argument became hntp")
	}
	fields[75] = strconv.Itoa(0x686e7470)
	if !encodedTailContainsTag(fields, 0x686e7470) {
		t.Fatal("hntp tag lost")
	}
	fields[76] = strconv.Itoa(0x67657476)
	for _, c := range []struct {
		kind int
		want bool
	}{{0x52504255, true}, {0x53544455, true}, {0x44544452, false}} {
		fields[77] = strconv.Itoa(c.kind)
		if got := encodedStealthDuration(fields); got != c.want {
			t.Fatalf("kind %x duration=%v", c.kind, got)
		}
	}
}
func TestMinimapSkillMetadataPublication(t *testing.T) {
	skills := sharedShippedSkills(t)
	hunting := 0
	for _, row := range skills.SpawnSkillRows() {
		source, ok := skills.SkillByID(row.ID)
		if !ok || row.HuntingPoint != source.HuntingPoint || row.StealthDuration != source.StealthDuration {
			t.Fatalf("minimap metadata lost for %d", row.ID)
		}
		if row.HuntingPoint {
			hunting++
		}
	}
	if hunting == 0 {
		t.Fatal("retail hunting skill metadata absent")
	}
}
