package enterworld

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"
	"testing"
)

type coverageBlock struct {
	Known  bool     `json:"known"`
	Column int      `json:"column"`
	Tag    string   `json:"tag"`
	Args   []string `json:"args"`
}
type coverageRow struct {
	Position  bool            `json:"position_effect"`
	Instant   bool            `json:"instant_self_effect"`
	ID        uint32          `json:"id"`
	Fields    []string        `json:"fields"`
	ChainSub  bool            `json:"chain_sub"`
	Offensive bool            `json:"offensive_sequence"`
	Recovery  bool            `json:"flat_self_recovery"`
	Critical  bool            `json:"passive_critical"`
	Defense   bool            `json:"passive_defense"`
	Passive   bool            `json:"passive_damage"`
	Imbue     bool            `json:"weapon_imbue"`
	Movement  bool            `json:"movement_descriptor_only"`
	Programs  []coverageBlock `json:"programs"`
	Refusal   string          `json:"offense_refusal"`
}

func (r coverageRow) executable() bool {
	return r.Position || r.Offensive || r.Recovery || r.Critical || r.Passive || r.Defense || r.Imbue || r.Instant
}

type coverageInput struct {
	Schema string            `json:"schema"`
	Rows   []coverageRow     `json:"rows"`
	Hashes map[string]string `json:"sha256"`
}
type coverageEntry struct {
	ID             uint32   `json:"id"`
	Name           string   `json:"name"`
	Stages         []uint32 `json:"stages"`
	Problems       []string `json:"problems"`
	Decoded        bool     `json:"decoded"`
	Executable     bool     `json:"executable"`
	Tested         bool     `json:"tested"`
	RetailCompared bool     `json:"retail_compared"`
	Family         string   `json:"family"`
	Exact          string   `json:"exact_program"`
}
type coverageFamily struct {
	Signature  string   `json:"signature"`
	Roots      []uint32 `json:"roots"`
	Executable int      `json:"executable"`
}
type coverageReview struct {
	Reason            string   `json:"reason"`
	AffectedRoots     []uint32 `json:"affected_roots"`
	GuaranteedUnlocks *int     `json:"guaranteed_unlocks"`
}
type coverageReport struct {
	Schema        string           `json:"schema"`
	InputSHA      string           `json:"input_sha256"`
	Qualification string           `json:"qualification"`
	Rows          []coverageEntry  `json:"roots"`
	Families      []coverageFamily `json:"families"`
	Review        []coverageReview `json:"ranked_review"`
	Counts        map[string]int   `json:"counts"`
}

// Exact variants retain every field. Families normalize magnitudes but preserve
// branch selectors, target flags, resource families and ordered linked stages.
func coverageStage(r coverageRow) any {
	envelope := map[int]string{}
	for _, i := range []int{8, 12, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 50, 51, 56, 68} {
		envelope[i] = r.Fields[i]
	}
	for _, i := range []int{10, 11, 16, 52, 53, 54, 55} {
		if r.Fields[i] == "0" {
			envelope[i] = "zero"
		} else {
			envelope[i] = "nonzero"
		}
	}
	programs := []any{}
	for _, b := range r.Programs {
		selectors := map[int]string{}
		switch b.Tag {
		case "67657476", "73657476", "617474":
			if len(b.Args) > 0 {
				selectors[0] = b.Args[0]
			}
		case "656672":
			for _, i := range []int{0, 1, 5} {
				if i < len(b.Args) {
					selectors[i] = b.Args[i]
				}
			}
		case "636e736d", "72657169", "6d63", "636d":
			for i, a := range b.Args {
				selectors[i] = a
			}
		}
		programs = append(programs, []any{b.Known, b.Tag, len(b.Args), selectors})
	}
	return []any{envelope, programs}
}
func coverageDigest(v any) string {
	b, _ := json.Marshal(v)
	return fmt.Sprintf("%x", sha256.Sum256(b))
}
func buildSkillCoverage(input coverageInput) (coverageReport, error) {
	out := coverageReport{Schema: "sro-skill-closure-coverage-v1", Counts: map[string]int{}, Qualification: "Executable means production admission only. Tested and retail_compared require per-closure evidence; neither is inferred. Ranked failures are affected roots, not promised unlocks."}
	byID := map[uint32]coverageRow{}
	for _, r := range input.Rows {
		if len(r.Fields) != 118 || r.ID == 0 {
			return out, fmt.Errorf("invalid row %d", r.ID)
		}
		if _, ok := byID[r.ID]; ok {
			return out, fmt.Errorf("duplicate row %d", r.ID)
		}
		byID[r.ID] = r
	}
	families := map[string]*coverageFamily{}
	reviews := map[string]map[uint32]bool{}
	for _, root := range input.Rows {
		if root.Fields[0] != "1" || root.ChainSub || !strings.HasPrefix(root.Fields[3], "SKILL_CH_") && !strings.HasPrefix(root.Fields[3], "SKILL_EU_") {
			continue
		}
		entry := coverageEntry{ID: root.ID, Name: root.Fields[3], Decoded: true, Executable: root.executable()}
		seen := map[uint32]bool{}
		shapes := []any{}
		exact := [][]string{}
		id := root.ID
		for id != 0 {
			if seen[id] {
				entry.Problems = append(entry.Problems, fmt.Sprintf("chain:cycle:%d", id))
				entry.Decoded = false
				break
			}
			seen[id] = true
			r, ok := byID[id]
			if !ok {
				entry.Problems = append(entry.Problems, fmt.Sprintf("chain:missing:%d", id))
				entry.Decoded = false
				break
			}
			entry.Stages = append(entry.Stages, id)
			shapes = append(shapes, coverageStage(r))
			exact = append(exact, r.Fields)
			for _, b := range r.Programs {
				if !b.Known {
					entry.Decoded = false
					entry.Problems = append(entry.Problems, "decode:unknown:"+b.Tag)
				}
			}
			if !entry.Executable && r.Refusal != "" {
				reason := r.Refusal
				if reason == "offense:invalid-envelope-or-arguments" {
					parts := []string{}
					for _, b := range r.Programs {
						part := b.Tag
						if (b.Tag == "73657476" || b.Tag == "67657476") && len(b.Args) > 0 {
							part += ":" + b.Args[0]
						}
						parts = append(parts, part)
					}
					reason += ";activity=" + r.Fields[8] + ";kind=" + r.Fields[68] + ";program=" + strings.Join(parts, ",")
				}
				entry.Problems = append(entry.Problems, reason)
			}
			if id != root.ID && (r.Fields[2] != root.Fields[2] || r.Fields[7] != root.Fields[7]) {
				entry.Problems = append(entry.Problems, "chain:foreign-group-or-rank")
			}
			id = textdataU32(r.Fields[9])
		}
		if !entry.Executable && len(entry.Problems) == 0 {
			entry.Problems = append(entry.Problems, "execution:unimplemented-envelope-or-chain")
		}
		entry.Family = coverageDigest(shapes)
		entry.Exact = coverageDigest(exact)
		f := families[entry.Family]
		if f == nil {
			f = &coverageFamily{Signature: entry.Family}
			families[entry.Family] = f
		}
		f.Roots = append(f.Roots, root.ID)
		if entry.Executable {
			f.Executable++
		}
		out.Counts["roots"]++
		if entry.Decoded {
			out.Counts["decoded"]++
		}
		if entry.Executable {
			out.Counts["executable"]++
		}
		if !entry.Executable {
			for _, reason := range entry.Problems {
				if reviews[reason] == nil {
					reviews[reason] = map[uint32]bool{}
				}
				reviews[reason][root.ID] = true
			}
		}
		out.Rows = append(out.Rows, entry)
	}
	for _, f := range families {
		sort.Slice(f.Roots, func(i, j int) bool { return f.Roots[i] < f.Roots[j] })
		out.Families = append(out.Families, *f)
	}
	for reason, ids := range reviews {
		r := coverageReview{Reason: reason}
		for id := range ids {
			r.AffectedRoots = append(r.AffectedRoots, id)
		}
		sort.Slice(r.AffectedRoots, func(i, j int) bool { return r.AffectedRoots[i] < r.AffectedRoots[j] })
		out.Review = append(out.Review, r)
	}
	sort.Slice(out.Rows, func(i, j int) bool { return out.Rows[i].ID < out.Rows[j].ID })
	sort.Slice(out.Families, func(i, j int) bool {
		a, b := out.Families[i], out.Families[j]
		if len(a.Roots) != len(b.Roots) {
			return len(a.Roots) > len(b.Roots)
		}
		return a.Signature < b.Signature
	})
	sort.Slice(out.Review, func(i, j int) bool {
		a, b := out.Review[i], out.Review[j]
		if len(a.AffectedRoots) != len(b.AffectedRoots) {
			return len(a.AffectedRoots) > len(b.AffectedRoots)
		}
		return a.Reason < b.Reason
	})
	out.Counts["families"] = len(out.Families)
	out.Counts["tested"] = 0
	out.Counts["retail_compared"] = 0
	return out, nil
}
func TestExportSkillClosureCoverage(t *testing.T) {
	in, out := os.Getenv("SRO_SKILL_COVERAGE_INPUT"), os.Getenv("SRO_SKILL_COVERAGE_OUT")
	// Input is also consumed by the lifecycle receipt producer. Only an
	// explicit output opts into this exporter; a shared input is not a request.
	if out == "" {
		t.Skip("set SRO_SKILL_COVERAGE_INPUT and SRO_SKILL_COVERAGE_OUT")
	}
	if in == "" || out == "" {
		t.Fatal("both paths required")
	}
	b, err := os.ReadFile(in)
	if err != nil {
		t.Fatal(err)
	}
	var input coverageInput
	if err = json.Unmarshal(b, &input); err != nil {
		t.Fatal(err)
	}
	if input.Schema != "sro-skill-execution-inventory-v3" {
		t.Fatal("requires known/unknown token classification from v3 inventory")
	}
	report, err := buildSkillCoverage(input)
	if err != nil {
		t.Fatal(err)
	}
	report.InputSHA = fmt.Sprintf("%x", sha256.Sum256(b))
	if receiptPath := os.Getenv("SRO_SKILL_QUALIFICATION_INPUT"); receiptPath != "" {
		evidence, readErr := os.ReadFile(receiptPath)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if err := applySkillQualification(&report, evidence); err != nil {
			t.Fatal(err)
		}
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(out, append(encoded, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("coverage %v", report.Counts)
}
func TestSkillCoverageTraversesWholeGraphsAndNeverInventsQualification(t *testing.T) {
	makeRow := func(id uint32, child string) coverageRow {
		f := make([]string, 118)
		for i := range f {
			f[i] = "0"
		}
		f[0] = "1"
		f[2] = "1"
		f[3] = "SKILL_CH_TEST"
		f[9] = child
		return coverageRow{ID: id, Fields: f, Programs: []coverageBlock{{Known: true, Tag: "617474", Args: []string{"4", "100", "10", "10", "0"}}}}
	}
	a, b := makeRow(1, "2"), makeRow(2, "0")
	b.ChainSub = true
	b.Refusal = "offense:instruction:heal"
	report, err := buildSkillCoverage(coverageInput{Rows: []coverageRow{a, b}})
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Rows) != 1 || len(report.Rows[0].Stages) != 2 || report.Rows[0].Executable || report.Rows[0].Tested || report.Rows[0].RetailCompared {
		t.Fatal(report)
	}
	original := report.Rows[0].Family
	b.Fields[22] = "1"
	changed, _ := buildSkillCoverage(coverageInput{Rows: []coverageRow{a, b}})
	if changed.Rows[0].Family == original {
		t.Fatal("targeting difference merged")
	}
	b.Fields[9] = "1"
	cycle, _ := buildSkillCoverage(coverageInput{Rows: []coverageRow{a, b}})
	if cycle.Rows[0].Decoded {
		t.Fatal("cycle decoded")
	}
	missing, _ := buildSkillCoverage(coverageInput{Rows: []coverageRow{a}})
	if missing.Rows[0].Decoded {
		t.Fatal("missing stage decoded")
	}
	b.Fields[9] = "0"
	b.Programs[0].Known = false
	unknown, _ := buildSkillCoverage(coverageInput{Rows: []coverageRow{a, b}})
	if unknown.Rows[0].Decoded {
		t.Fatal("unknown opcode decoded")
	}
}

type skillQualification struct {
	Schema string   `json:"schema"`
	Input  string   `json:"input_sha256"`
	Kind   string   `json:"kind"`
	Test   string   `json:"test"`
	Passed bool     `json:"passed"`
	Rows   []uint32 `json:"rows"`
}

func applySkillQualification(report *coverageReport, evidence []byte) error {
	var q skillQualification
	if err := json.Unmarshal(evidence, &q); err != nil {
		return err
	}
	if q.Schema != "sro-skill-qualification-v1" || q.Input != report.InputSHA || !q.Passed || q.Kind != "server-integration" || q.Test == "" || len(q.Rows) == 0 {
		return fmt.Errorf("stale, failed or unsupported qualification")
	}
	// Native comparisons remain a separate, unqualified plane. A server test
	// can never promote retail_compared or imply visual/audio qualification.
	indices := map[uint32]int{}
	for i, r := range report.Rows {
		indices[r.ID] = i
	}
	for _, id := range q.Rows {
		i, ok := indices[id]
		if !ok || !report.Rows[i].Executable {
			return fmt.Errorf("unadmitted qualification row %d", id)
		}
	}
	for _, id := range q.Rows {
		i := indices[id]
		if !report.Rows[i].Tested {
			report.Rows[i].Tested = true
			report.Counts["tested"]++
		}
	}
	return nil
}
func TestSkillQualificationRejectsStaleAndFailedEvidence(t *testing.T) {
	report := coverageReport{InputSHA: "a", Counts: map[string]int{}, Rows: []coverageEntry{{ID: 1, Executable: true}}}
	for _, input := range []string{
		`{"schema":"sro-skill-qualification-v1","input_sha256":"b","kind":"server-integration","test":"test","passed":true,"rows":[1]}`,
		`{"schema":"sro-skill-qualification-v1","input_sha256":"a","kind":"server-integration","test":"test","passed":false,"rows":[1]}`,
	} {
		if applySkillQualification(&report, []byte(input)) == nil {
			t.Fatal("invalid evidence accepted")
		}
	}
	valid := []byte(`{"schema":"sro-skill-qualification-v1","input_sha256":"a","kind":"server-integration","test":"test","passed":true,"rows":[1]}`)
	if err := applySkillQualification(&report, valid); err != nil {
		t.Fatal(err)
	}
	if !report.Rows[0].Tested || report.Rows[0].RetailCompared || report.Counts["tested"] != 1 {
		t.Fatal("qualification planes mixed")
	}
}
