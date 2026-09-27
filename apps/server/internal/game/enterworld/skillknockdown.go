package enterworld

// ko is the authored rank/chance pair (58791F); capability belongs to the
// victim's RefObjChar.Knockdown bit 0, not to its name or monster rarity.
type SkillKnockdown struct {
	Present      bool
	Rank, Chance uint32
}

// kb: 587933 indexes two unsigned words. 5A1A20 requires signed-positive
// chance, while 590286 converts the distance as unsigned. Unlike ko, no
// target-level scaling or 75-percent clamp is applied.
type SkillKnockback struct {
	Present          bool
	Chance, Distance uint32
}
