package enterworld

import (
	"strconv"
	"testing"
)

func TestSkillProgramDiscriminatingBoundaries(t *testing.T) {
	base := func() []string {
		f := make([]string, 118)
		for i := range f {
			f[i] = "0"
		}
		return f
	}
	f := base()
	// An argument that spells another opcode must never become an instruction.
	copy(f[69:], []string{strconv.Itoa(0x73657476), strconv.Itoa(0x64656670), "-1", "0", "0", strconv.Itoa(0x68737465), "20"})
	p, err := CompileSkillProgram(f)
	if err != nil || p.Len() != 2 {
		t.Fatalf("program=%+v error=%v", p, err)
	}
	if p.Instruction(0).Arguments[1] != 0xffffffff || p.Instruction(1).Column != 74 {
		t.Fatal("signed words or padding changed")
	}
	value := p.Instruction(0)
	value.Tag = 0
	if p.Instruction(0).Tag != 0x73657476 {
		t.Fatal("instruction copy mutated program")
	}
	for _, tc := range []struct {
		name  string
		col   int
		value string
	}{
		{"unknown-after-padding", 76, "1234567"}, {"argument-overflow", 71, "4294967296"}, {"argument-underflow", 71, "-2147483649"}, {"malformed", 71, "bad"}, {"truncated", 117, strconv.Itoa(0x617474)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := append([]string(nil), f...)
			m[tc.col] = tc.value
			if _, err := CompileSkillProgram(m); err == nil {
				t.Fatal("invalid program admitted")
			}
		})
	}
	f = base()
	f[69] = strconv.Itoa(0x73736f75)
	f[70] = "bad"
	if p, err := CompileSkillProgram(f); err != nil || p.Len() != 1 {
		t.Fatal("terminal instruction must stop indexing", err)
	}
}
