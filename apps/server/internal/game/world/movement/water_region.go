package movement

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const (
	regionIDRadix         = 16
	regionIDParseBitWidth = 16
)

func formatRegionID(id uint16) string {
	return fmt.Sprintf("0x%04x", id)
}

func parseRegionID(id string) uint16 {
	trimmed := strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(id), "0X"), "0x")
	parsed, err := strconv.ParseUint(trimmed, regionIDRadix, regionIDParseBitWidth)
	if err != nil {
		return 0
	}
	return uint16(parsed)
}

func normalizeRegionID(id string) string {
	if id == "" {
		return ""
	}
	return formatRegionID(parseRegionID(id))
}

func jsonInt(number json.Number) (int, bool) {
	if number == "" {
		return 0, false
	}
	value, err := number.Float64()
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	if value != math.Trunc(value) {
		return 0, false
	}
	return int(value), true
}
