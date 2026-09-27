package monster

// SelfEffect retains installation values, independent of later actor stats.
// Only complete token-bearing, phase-free self programs enter this projection.
type SelfEffect struct {
	SkillID, Token, Tag, First, Second uint32
	StartedAtMs, UntilMs               int64
}
type SelfEffects [8]SelfEffect

func (e SelfEffect) Active(now int64) bool {
	return e.Token != 0 && uint32(now-e.StartedAtMs) <= uint32(e.UntilMs-e.StartedAtMs)
}
