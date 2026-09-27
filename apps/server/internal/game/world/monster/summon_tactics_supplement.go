package monster

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
)

// Catalog-owned later ISRO-R data, not v1.150 server provenance. Only the
// sixteen previously absent own references are supplemented. Existing v1.188
// records and the native own-before-original lookup remain authoritative.
//
//go:embed data/isror_summon_tactics.json
var supplementalSummonTacticsJSON []byte

type supplementalSummonTactics struct {
	Source, SourceSHA256 string
	Rows                 []struct {
		Codename             string
		PrimaryRefID         uint32
		Normal, Champion     []TacticsControls
		ObjectSourceOffset   uint64
		TacticsSourceOffsets []uint64
		ConditionalSkills    []ConditionalSkill
	}
}

func loadSupplementalSummonTactics(out map[string][2][]SummonTactics) {
	var doc supplementalSummonTactics
	d := json.NewDecoder(bytes.NewReader(supplementalSummonTacticsJSON))
	d.DisallowUnknownFields()
	if err := d.Decode(&doc); err != nil {
		panic(fmt.Errorf("summon tactics supplement: %w", err))
	}
	if doc.Source != "isror-catalog-owned" || doc.SourceSHA256 != "89c6835f8e51b1a75950242c89cf3ad639ea7d50a22191a90632cca333664a45" || len(doc.Rows) != 16 {
		panic("summon tactics supplement provenance/closure mismatch")
	}
	for _, row := range doc.Rows {
		if _, exists := out[row.Codename]; exists {
			panic("summon tactics source collision: " + row.Codename)
		}
		if row.Codename == "" || row.PrimaryRefID == 0 || row.ObjectSourceOffset == 0 || len(row.Normal) == 0 || len(row.Champion) == 0 || len(row.TacticsSourceOffsets) != len(row.Normal)+len(row.Champion) {
			panic("incomplete summon tactics supplement")
		}
		var groups [2][]SummonTactics
		for group, records := range [2][]TacticsControls{row.Normal, row.Champion} {
			for _, c := range records {
				if c.ID == 0 || c.ObjectID == 0 || c.SightRange < 0 || (c.ChampionID != 0) != (group == 0) || !c.HasAggroType || c.AggroType != 0 {
					panic("invalid or unsupported supplemental tactics group")
				}
				selected := SummonTactics{TargetPolicy: c.ChangeTarget, SightRange: float64(c.SightRange), NativeFlags: c.Flags, Controls: c, HasControls: true}
				n := 0
				for _, binding := range row.ConditionalSkills {
					if binding.TacticsID != c.ID {
						continue
					}
					if n == len(selected.ConditionalSkills) || binding.SkillID == 0 || binding.Codename == "" || binding.SourceOffset == 0 || binding.ConditionType != 0 || binding.Minimum != 0 || binding.Maximum != 0 || binding.Option != 0 {
						panic("unsupported or incomplete summoned conditional skill")
					}
					selected.ConditionalSkills[n] = binding
					n++
				}
				groups[group] = append(groups[group], selected)
			}
		}
		out[row.Codename] = groups
	}
}
