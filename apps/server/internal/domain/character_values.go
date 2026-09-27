package domain

// coerceInt applies an absent-value fallback and clamps present values.
func coerceInt(value *int64, min, max, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	result := *value
	if result < min {
		return min
	}
	if result > max {
		return max
	}
	return result
}

// coerceOptionalInt clamps present values and preserves absence.
func coerceOptionalInt(value *int64, min, max int64) (int64, bool) {
	if value == nil {
		return 0, false
	}
	result := *value
	if result < min {
		result = min
	}
	if result > max {
		result = max
	}
	return result, true
}

func clampFloat(value, min, max float64) float64 {
	if value != value {
		return min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
