package wire

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func TestSkillAreaSharedClientFixture(t *testing.T) {
	var fixture struct {
		SkillID, CasterGID, InstanceToken uint32
		Targets                           []struct {
			GID, BeforeHP, Damage uint32
			Fatal                 bool
		}
		PayloadHex string
	}
	raw, err := os.ReadFile("testdata/skill_area_result_fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	var targets []SkillAreaTarget
	for _, target := range fixture.Targets {
		targets = append(targets, SkillAreaTarget{GID: target.GID, Impacts: []SkillCastTargetImpact{{ResultFlags: 1, Damage: target.Damage, Fatal: target.Fatal}}})
	}
	frame := SkillCastAreaFrame(SkillCastSuccess{SkillId: fixture.SkillID, CasterGid: fixture.CasterGID, InstanceToken: fixture.InstanceToken}, fixture.Targets[0].GID, targets)
	if frame.Opcode != OpSkillCastResult || hex.EncodeToString(frame.Payload) != fixture.PayloadHex {
		t.Fatalf("wire mismatch %x", frame.Payload)
	}
}
