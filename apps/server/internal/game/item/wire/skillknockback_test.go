package wire

import (
	"bytes"
	"testing"
)

func TestDisplacementImpactWirePrecedence(t *testing.T) {
	point, _ := NewSkillCastFacingPoint(0x62a8, 101.9, 20, -4.9)
	for _, tc := range []struct {
		name   string
		impact SkillCastTargetImpact
		tag    byte
		length int
	}{
		{"kb", SkillCastTargetImpact{Knockback: point}, 5, 17},
		{"ko-priority", SkillCastTargetImpact{Knockdown: point, Knockback: point}, 4, 17},
		{"fatal", SkillCastTargetImpact{Knockback: point, Fatal: true}, 128, 9},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := NewWriter(17)
			tc.impact.Damage = 123
			tc.impact.ResultFlags = 2
			tc.impact.writeTo(w)
			p := w.Payload()
			if len(p) != tc.length || p[0] != tc.tag || !bytes.Equal(p[1:9], []byte{2, 123, 0, 0, 0, 0, 0, 0}) {
				t.Fatalf("wire %x", p)
			}
			if tc.length == 17 && !bytes.Equal(p[9:], []byte{0xa8, 0x62, 101, 0, 20, 0, 0xfc, 0xff}) {
				t.Fatalf("pose %x", p)
			}
		})
	}
}
