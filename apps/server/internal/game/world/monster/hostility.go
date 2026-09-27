package monster

// HostilityObserver and HostilityTarget are the inputs consumed by the default
// world controller's mob decision (v1.188 604E00 -> 5298C0 -> 5299E0).
// They are values, not a shared combat-eligibility cache. Numeric restrictions
// remain unnamed where their gameplay producers have not been recovered.
type HostilityObserver struct {
	TID             uint16
	ReferenceFlags  uint32
	Mode            uint8 // 4A98A0's temporary mode; ordinary acquisition passes 1
	Level           uint8
	Rarity          uint8
	RestrictionD34  uint32
	Restriction118C bool
	ExcludedGID     uint32
	HasBoundTarget  bool
	BoundTargetGID  uint32
}

type HostilityTarget struct {
	GID              uint32
	BodyStatus       uint8
	RejectedType43C  bool
	Player           bool
	RestrictionC44   bool
	RejectedType3C   bool
	ProtectionActive bool
	ProtectionMask   uint32
	ProtectionLevel  uint32
}

// AllowsHostility implements the player-target projection. COS substitution
// at 529929 and non-default world controllers require their own adapters.
// LIFE/visibility are caller responsibilities: this function does not invent
// a life test or replace the independent 540DE0 observer-status predicate.
func AllowsHostility(actor HostilityObserver, target HostilityTarget) bool {
	if target.GID == 0 || target.RejectedType43C ||
		(target.BodyStatus >= 2 && target.BodyStatus <= 4) {
		return false
	}
	if target.BodyStatus == 6 || target.BodyStatus == 7 {
		// 529A60 jumps directly to success after detection. In particular it
		// skips the excluded-GID and bound-target checks below.
		if actor.TID&2 == 0 || actor.TID&0x1c != 4 || actor.TID&0x60 != 0x40 ||
			actor.TID&0x780 != 0x80 || actor.ReferenceFlags&0x200 == 0 {
			return false
		}
	} else {
		if actor.RestrictionD34&0x200 != 0 && actor.Restriction118C && target.GID == actor.ExcludedGID {
			return false
		}
		if actor.HasBoundTarget && target.GID != actor.BoundTargetGID {
			return false
		}
	}
	if (target.Player && target.RestrictionC44) || target.RejectedType3C {
		return false
	}
	if actor.Mode == 0 || actor.TID&0xfffe != 0x8c6 || !target.ProtectionActive {
		return true
	}
	var mask uint32
	switch actor.Rarity & 0xf {
	case 0:
		mask = 1
	case 1:
		mask = 2
	case 3:
		mask = 4
	case 6:
		mask = 8
	}
	return target.ProtectionMask&mask == 0 || uint32(actor.Level) > target.ProtectionLevel
}
