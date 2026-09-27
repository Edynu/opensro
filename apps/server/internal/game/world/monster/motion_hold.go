package monster

// MotionHold is the native state timer installed through vfunc55C. It is
// orthogonal to AI targeting: hits may update aggression while motion 8
// prevents the actor from moving or starting an action.
type MotionHold struct {
	State   uint8
	UntilMs int64
}

func (h MotionHold) StateAt(now int64) uint8 {
	if now < h.UntilMs {
		return h.State
	}
	return 0
}
