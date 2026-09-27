package enterworld

import "testing"

type sequenceSource map[uint32]SkillRow

func (s sequenceSource) SkillByID(id uint32) (SkillRow, bool) { r, ok := s[id]; return r, ok }

func TestOffensiveSequenceRejectsIncompleteGraphs(t *testing.T) {
	for _, mode := range []string{"valid", "missing", "cycle", "foreign-group", "foreign-level", "unsupported-tail", "paid-tail", "unmarked-tail", "zero-duration", "sub-root"} {
		t.Run(mode, func(t *testing.T) {
			root := SkillRow{ID: 6, Group: 177, Level: 1, ChainNext: 7, OffensiveStagePinned: true,
				Consumption: SkillConsumption{Pinned: true, MP: 32}, ActionCastingTimePinned: true, ActionDurationPinned: true, ActionDurationMs: 428}
			tail := root
			tail.ID = 7
			tail.ChainNext = 0
			tail.ChainSub = true
			tail.Consumption.MP = 0
			switch mode {
			case "missing":
				root.ChainNext = 99
			case "cycle":
				tail.ChainNext = 6
			case "foreign-group":
				tail.Group++
			case "foreign-level":
				tail.Level++
			case "unsupported-tail":
				tail.OffensiveStagePinned = false
			case "paid-tail":
				tail.Consumption.MP = 1
			case "unmarked-tail":
				tail.ChainSub = false
			case "zero-duration":
				tail.ActionDurationMs = 0
			case "sub-root":
				root.ChainSub = true
			}
			rows, ok := OffensiveSequence(sequenceSource{6: root, 7: tail}, 6)
			if ok != (mode == "valid") {
				t.Fatalf("%s accepted=%v rows=%v", mode, ok, rows)
			}
		})
	}
}
