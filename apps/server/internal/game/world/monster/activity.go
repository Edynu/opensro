package monster

// ActivityCadence is CTactics+150/+154. This is not Timer 1 (acquisition)
// and not the CAIState deadline. 53F614 initializes the clock and draws
// rand()%1000+1000 once; 53D860/55AF60 preserve it across PENDING.
type ActivityCadence struct {
	Interval  uint16
	LastCheck uint32
}

func NewActivityCadence(now, random uint32) ActivityCadence {
	return ActivityCadence{Interval: uint16(random%1000 + 1000), LastCheck: now}
}

// Due advances even when the activity query is empty. Equality is not due;
// subtraction is unsigned to match the server's wraparound clock.
func (a *ActivityCadence) Due(now uint32) bool {
	if now-a.LastCheck <= uint32(a.Interval) {
		return false
	}
	a.LastCheck = now
	return true
}

// 540D20 excludes flags 04/80 and a bound control actor before checking
// WANDER. PENDING's resume callback does not repeat those admission guards.
func MaySuspendWander(flags uint32, controlled bool, mode MoverMode) bool {
	return flags&0x84 == 0 && !controlled && mode == MoverWandering
}
