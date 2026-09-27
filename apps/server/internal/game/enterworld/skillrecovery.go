/*
===========================================================================

skillrecovery.go - admitting self heals

===========================================================================
*/

package enterworld

/*
==================
SkillRecovery

SkillRecovery admits a self heal whose whole program is one flat heal
block (SkillHeal): no percent words, no weapon term, nothing after it.
resu/puls/mwhh/efr/getv cannot silently disappear from a cast.
==================
*/
type SkillRecovery struct {
	SelfFlatPinned bool
}

func parseSkillRecovery(fields []string, row *SkillRow) {
	if len(fields) != 118 || fields[0] != "1" || fields[8] != "2" || row.ChainNext != 0 ||
		row.TargetRequired || !row.Consumption.Pinned || !row.TimingPinned ||
		row.Consumption.HP != 0 || row.Consumption.HPPercent != 0 {
		return
	}
	// These columns own periodic/action-repeat/ground-target alternatives.
	for _, column := range []int{15, 16, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 56} {
		if fields[column] != "0" {
			return
		}
	}
	lifetime, ok := row.ActionLifecycleMs()
	if !ok || lifetime == 0 {
		return
	}
	// 5942AB..5942F3 selects the no-target healing branch; 5A0850
	// applies flat HP/MP when the percentage words are zero. Require the
	// entire program to be exactly heal, followed by zero padding.
	if fields[69] != "1751474540" {
		return
	}
	var values [4]uint32
	for i := range values {
		n, valid := textdataInt(fields[70+i])
		if !valid || n < 0 || n > 0x7fffffff {
			return
		}
		values[i] = uint32(n)
	}
	for _, field := range fields[74:] {
		if field != "0" {
			return
		}
	}
	if values[1] != 0 || values[3] != 0 || values[0] == 0 && values[2] == 0 {
		return
	}
	row.Recovery = SkillRecovery{SelfFlatPinned: true}
}
