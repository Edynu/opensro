package monster

import "math"

// TraceDecision is 5483C0/5484B0's reason byte, consumed by 559AD0.
// Reasons 2/3 change speed; they do NOT abandon the opponent. Reason 1
// enters IDLE (BATTLE::OnExit clears opponents), not HOMING.
type TraceDecision uint8

const (
	TraceContinue TraceDecision = iota
	TraceAbandon
	TraceRun
	TraceWalk
)

func (c TacticsControls) TraceEnabled() bool {
	return c.Flags&0x84 == 0 && c.TraceBoundary != 0 && c.TraceBoundary != 2
}

// EvaluateTrace runs only after Timer 6 opens. Distance is the float32 3D
// result of 53D7A0, NOT the distance from the nest. Indoor dispatch adds 100
// (53FD0F -> 5484B0). targetMoving is vslot +4C0, not a guessed speed flag.
func (c TacticsControls) EvaluateTrace(distance float32, targetMoving, indoor bool, now, lastActivity uint32) TraceDecision {
	if !c.TraceEnabled() {
		return TraceContinue
	}
	limit := c.TraceData
	if indoor {
		limit += 100
	}
	// TEST AH,41 / JP takes the continuation only for greater/unordered.
	// Equality therefore abandons too; translating JP as JBE loses this edge.
	if float64(distance) >= float64(limit) {
		return TraceAbandon
	}
	if now-lastActivity < 5000 {
		return TraceContinue
	}
	threshold := float32(150)
	if targetMoving {
		threshold = 100
	}
	if indoor {
		threshold += 100
	}
	if distance >= threshold || math.IsNaN(float64(distance)) {
		return TraceWalk
	}
	return TraceRun
}

// 5489B0 -> 541820 owns the wire channel. +164 is a left/right obstacle
// rotation sign and must never be interpreted as run/walk. Wild HOMING
// uses RUN if the authored run speed is available.
func HomingRuns(runSpeed float64) bool { return runSpeed > 0.000001 }

// 545F70 -> 546039: a nest-backed actor uses nRadius for type 0 and
// 1.5*nRadius for type 1. Other types accept the position. The boundary
// itself is outside; the native comparison is strictly distance < radius.
func (c TacticsControls) InsideHome(distance, radius float32) bool {
	if c.HomingType > 1 {
		return true
	}
	if c.HomingType == 1 {
		radius = float32(float64(radius) * 1.5)
	}
	return distance < radius
}
