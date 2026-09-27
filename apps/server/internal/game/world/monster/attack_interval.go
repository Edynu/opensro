package monster

// NextAttackInterval is the strategy setter 5619E0. randValue is a native
// CRT rand sample (0..32767), not an already uniform window remainder.
func NextAttackInterval(previous, cooldown, randValue uint32) uint32 {
	window := (previous * 2) / 10
	if window < 500 {
		window = 500
	}
	if window > 2000 {
		window = 2000
	}
	return cooldown + randValue%(window+1)
}
