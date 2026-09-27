package monster

// ConditionalHealthEligible preserves the two float32 spills and signed HP
// accessor values of research 5610B0/5611D0. The source threshold is unsigned.
// Entry lifetime is owned separately; eligibility must never reset consumption.
func ConditionalHealthEligible(currentHP, maximumHP, threshold uint32) bool {
	numerator := float32(float64(int32(currentHP)) * 100)
	metric := float32(float64(numerator) / float64(int32(maximumHP)))
	return float64(metric) <= float64(threshold)
}
