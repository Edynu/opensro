package enterworld

// SkillThreat is tnt2 (client block +198, server block +3CC). It modifies
// the action's aggression accumulator, never its HP damage or wire damage.
type SkillThreat struct {
	Present       bool
	Flat, Percent uint32
}
