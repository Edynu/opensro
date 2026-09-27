package combat

import "opensro.online/server/internal/game/enterworld"

// AccumulateThreat follows 5903EC..5904D3 once per impact. Each impact
// updates the SAME action/target accumulator, so two hits are not equivalent
// to multiplying the summed damage once. The low dword is retained after
// x87 truncation and after adding the flat term.
func AccumulateThreat(previous, damage uint32, modifier enterworld.SkillThreat) uint32 {
	previous += damage
	if !modifier.Present {
		return previous
	}
	return uint32(uint64(previous)*(100+uint64(modifier.Percent))/100) + modifier.Flat
}

// SplitLinkedThreat mirrors 5A03A0: lkag[0] is unsigned, the incoming
// aggression dword is signed, conversion truncates toward zero, and subtraction
// retains the low dword. Damage never enters this transfer.
func SplitLinkedThreat(aggression, percent uint32) (remaining, transferred uint32) {
	transferred = uint32(int64(int32(aggression)) * int64(percent) / 100)
	return aggression - transferred, transferred
}
