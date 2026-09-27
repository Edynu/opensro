package enterworld

// SkillBodyStatus is a bounded descriptor projection, not a skill-name guess.
// Only the plain hide setter is supported. Compound descriptors (speed,
// persistent-hide, linked entities, etc.) require their own complete handlers.
type SkillBodyStatus struct {
	Present   bool
	Supported bool
	Value     uint8
}

func encodedBodyStatus(fields []string) SkillBodyStatus {
	result := SkillBodyStatus{Present: encodedTailContainsTag(fields, 0x68696465)}
	if !result.Present {
		return result
	}
	supported := true
	for i := skilldataColEncodedTail; i < len(fields); {
		n, ok := textdataInt(fields[i])
		if !ok {
			return result
		}
		if n == 0 || n == 0x73736f75 {
			break
		}
		arity := spawnParamArity(uint32(n))
		if i+arity >= len(fields) {
			return result
		}
		switch n {
		case 0x68696465:
			mode, valid := textdataInt(fields[i+1])
			reserved, valid2 := textdataInt(fields[i+2])
			speed, valid3 := textdataInt(fields[i+3])
			if result.Value != 0 || !valid || !valid2 || !valid3 || (mode != 1 && mode != 2) || reserved != 0 || speed != 0 {
				supported = false
			}
			if mode == 1 {
				result.Value = 6
			} else if mode == 2 {
				result.Value = 7
			}
		case 0x64757261:
			duration, valid := textdataInt(fields[i+1])
			if !valid || duration <= 0 || duration > 0xffffffff {
				supported = false
			}
		case 0x65667461, 0x6e627566, 0x62627566:
		default:
			supported = false
		}
		i += 1 + arity
	}
	result.Supported = supported && result.Value != 0
	return result
}
