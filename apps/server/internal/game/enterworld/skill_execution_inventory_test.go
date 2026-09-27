/*
===========================================================================

skill_execution_inventory_test.go - exporting the skill execution inventory

===========================================================================
*/

package enterworld

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Opt-in inventory: uses the production loader and complete-chain admission,
// not a second implementation of the runtime's supported-program whitelist.
func TestExportSkillExecutionInventory(t *testing.T) {
	out := os.Getenv("SRO_SKILL_INVENTORY_OUT")
	if out == "" {
		t.Skip("set SRO_SKILL_INVENTORY_OUT to export the execution inventory")
	}
	dir := os.Getenv("SRO_SKILL_INVENTORY_DATA")
	if dir == "" {
		t.Fatal("SRO_SKILL_INVENTORY_DATA must name the production textdata directory")
	}
	source := NewTextdataSkills(dir)
	if err := source.Load(); err != nil {
		t.Fatal(err)
	}
	type block struct {
		Known  bool     `json:"known"`
		Column int      `json:"column"`
		Tag    string   `json:"tag"`
		Args   []string `json:"args"`
	}
	type record struct {
		PositionEffect     bool     `json:"position_effect"`
		OffenseRefusal     string   `json:"offense_refusal"`
		ID                 uint32   `json:"id"`
		Fields             []string `json:"fields"`
		ChainSub           bool     `json:"chain_sub"`
		OffensiveSequence  bool     `json:"offensive_sequence"`
		FlatSelfRecovery   bool     `json:"flat_self_recovery"`
		PassiveCritical    bool     `json:"passive_critical"`
		PassiveDefense     bool     `json:"passive_defense"`
		PassiveDamage      bool     `json:"passive_damage"`
		WeaponImbue        bool     `json:"weapon_imbue"`
		InstantSelfEffect  bool     `json:"instant_self_effect"`
		MovementDescriptor bool     `json:"movement_descriptor_only"`
		Programs           []block  `json:"programs"`
	}
	result := struct {
		Schema string            `json:"schema"`
		Total  int               `json:"loaded_rows"`
		Hashes map[string]string `json:"sha256"`
		Rows   []record          `json:"rows"`
	}{Schema: "sro-skill-execution-inventory-v3", Total: source.Len(), Hashes: map[string]string{}}
	hash := func(label, path string) {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		result.Hashes[label] = fmt.Sprintf("%x", sha256.Sum256(b))
	}
	hash("data/skilldata.txt", filepath.Join(dir, "skilldata.txt"))
	shards := []string{}
	for _, f := range readTextdataFile(filepath.Join(dir, "skilldata.txt")) {
		if len(f) != 1 {
			t.Fatalf("invalid shard index: %v", f)
		}
		shards = append(shards, f[0])
	}
	shards = append(shards, "skilldata_virtual.txt")
	seen := map[uint32]bool{}
	for _, shard := range shards {
		path := filepath.Join(dir, shard)
		hash("data/"+shard, path)
		for _, f := range readTextdataFile(path) {
			if len(f) != 118 {
				t.Fatalf("%s: unexpected width %d", shard, len(f))
			}
			id := textdataU32(f[1])
			if id == 0 || seen[id] {
				t.Fatalf("invalid/duplicate id %d", id)
			}
			seen[id] = true
			row, ok := source.SkillByID(id)
			if !ok || row.Codename != f[3] {
				t.Fatalf("loader mismatch %d", id)
			}
			_, offense := OffensiveSequence(source, id)
			r := record{PositionEffect: row.PositionEffect.Pinned, PassiveDefense: row.PassiveDefense.Pinned && !row.ChainSub && row.ChainNext == 0, InstantSelfEffect: row.InstantSelfEffectPinned, OffenseRefusal: row.OffenseRefusal, ID: id, Fields: f, ChainSub: row.ChainSub, OffensiveSequence: offense, FlatSelfRecovery: row.Recovery.SelfFlatPinned && !row.ChainSub, PassiveCritical: row.PassiveCritical.Pinned && !row.ChainSub, PassiveDamage: row.PassiveParameters.Pinned && !row.ChainSub, WeaponImbue: row.Imbue.Pinned && !row.ChainSub, MovementDescriptor: row.MovementModifier.Supported}
			program, err := CompileSkillProgram(f)
			if err != nil {
				t.Fatalf("skill %d: %v", id, err)
			}
			for index := 0; index < program.Len(); index++ {
				instruction := program.Instruction(index)
				col, count := int(instruction.Column), int(instruction.Count)
				r.Programs = append(r.Programs, block{true, col, fmt.Sprintf("%x", instruction.Tag), f[col+1 : col+1+count]})
			}
			result.Rows = append(result.Rows, r)
		}
	}
	if len(seen) != source.Len() {
		t.Fatal("raw/production denominator mismatch")
	}
	for _, name := range []string{"skillprogram.go", "skillexecutionplan.go", "skilldata.go", "skilloffense.go", "skillsequence.go", "skillrecovery.go", "skillimbue.go", "skillmovement.go", "skillpassive.go", "skillpassive_damage.go", "skillpassive_defense.go", "skillabnormal.go", "spawnskillparams.go", "skill_execution_inventory_test.go"} {
		hash("enterworld/"+name, name)
	}
	for _, name := range []string{"action/skillcost.go", "action/skillposition.go", "enterworld/skillposition.go", "action/monsterabnormal.go", "action/runtime_lifecycle.go", "abnormal/status.go", "abnormal/roll.go", "abnormal/block.go", "abnormal/callbacks.go", "abnormal/evaluate.go", "combat/monster_self_effect.go", "world/monster/abnormal.go", "world/simulation/monsterstate_abnormal.go", "world/simulation/monster_storage.go", "action/runtime.go", "action/skillknockdown.go", "action/skillcombat.go", "action/skillarea.go", "action/critical.go", "world/simulation/monsterstate_damage.go", "world/simulation/monsterstate_impact.go", "item/wire/skillcast.go", "action/skillrecovery.go", "action/skillimbue.go", "action/activeeffect.go", "action/movementeffect.go", "action/skilljobs.go", "action/skillmovement_test.go", "combat/stats.go", "combat/passives.go", "combat/formula.go", "combat/skillparameters.go", "combat/mastery.go", "progression/runtime.go"} {
		path := filepath.Join("..", name)
		if _, err := os.Stat(path); err == nil {
			hash(name, path)
		} else {
			t.Fatal(err)
		}
	}
	sort.Slice(result.Rows, func(i, j int) bool { return result.Rows[i].ID < result.Rows[j].ID })
	b, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Dir(out), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(out, append(b, '\n'), 0644); err != nil {
		t.Fatal(err)
	}
	t.Logf("exported %d rows from %d loaded rows", len(result.Rows), result.Total)
}
