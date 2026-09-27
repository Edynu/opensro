package enterworld

import (
	"encoding/json"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// missionSystemChatColorArgb is the default system-line color (Node
// missionSystemChatColorArgb).
const missionSystemChatColorArgb uint32 = 0xffdbc99b

// MissionChatConfigMessage is one config/mission-chat.json message row. The
// color fields stay raw because the Node coercer accepts numbers and several
// string spellings.
type MissionChatConfigMessage struct {
	Text         string          `json:"text"`
	ColorArgb    json.RawMessage `json:"colorArgb"`
	Color        json.RawMessage `json:"color"`
	SystemFilter string          `json:"systemFilter"`
}

// MissionChatConfig mirrors config/mission-chat.json.
type MissionChatConfig struct {
	Messages []MissionChatConfigMessage `json:"messages"`
}

// LoadMissionChatConfig reads the mission chat config; a missing file is the
// empty config (Node readJsonOrDefault).
func LoadMissionChatConfig(path string) *MissionChatConfig {
	config := &MissionChatConfig{}
	text, err := os.ReadFile(path)
	if err != nil {
		return config
	}
	_ = json.Unmarshal(text, config)
	return config
}

// SystemMessage is one bootstrap systemMessages row.
type SystemMessage struct {
	ColorArgb    uint32 `json:"colorArgb"`
	SystemFilter string `json:"systemFilter,omitempty"`
	Text         string `json:"text"`
}

// systemMessageFilters ports coerceMissionSystemMessageFilter's allow-list.
var systemMessageFilters = map[string]bool{
	"gain": true, "fight": true, "status": true, "party": true, "game": true,
}

// BuildSystemMessages ports buildMissionBootstrapSystemMessages: template
// each configured line for the character, defaulting the color and gating
// the filter.
func BuildSystemMessages(config *MissionChatConfig, character *Character) []SystemMessage {
	messages := []SystemMessage{}
	if config == nil {
		return messages
	}
	for _, entry := range config.Messages {
		text := templateMissionChatText(entry.Text, character)
		if text == "" {
			continue
		}
		color := missionSystemChatColorArgb
		raw := entry.ColorArgb
		if len(raw) == 0 || string(raw) == "null" {
			raw = entry.Color
		}
		if parsed, ok := coerceOptionalArgb(raw); ok {
			color = parsed
		}
		filter := ""
		if systemMessageFilters[entry.SystemFilter] {
			filter = entry.SystemFilter
		}
		messages = append(messages, SystemMessage{
			ColorArgb:    color,
			SystemFilter: filter,
			Text:         text,
		})
	}
	return messages
}

// templateMissionChatText ports templateMissionChatText.
func templateMissionChatText(text string, character *Character) string {
	if text == "" {
		return ""
	}
	name := ""
	if character != nil {
		name = character.Name
	}
	return strings.ReplaceAll(text, "{characterName}", name)
}

var decimalPattern = regexp.MustCompile(`^\d+$`)
var hexPattern = regexp.MustCompile(`^[0-9a-fA-F]+$`)

// coerceOptionalArgb ports coerceOptionalArgb: integer numbers, decimal
// strings, and #/0x-prefixed hex (6 digits gain an opaque alpha, 8 pass
// through).
func coerceOptionalArgb(raw json.RawMessage) (uint32, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var asNumber float64
	if err := json.Unmarshal(raw, &asNumber); err == nil {
		if asNumber < 0 || asNumber > math.MaxUint32 || asNumber != math.Trunc(asNumber) {
			return 0, false
		}
		return uint32(asNumber), true
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err != nil {
		return 0, false
	}
	trimmed := strings.TrimSpace(asString)
	if trimmed == "" {
		return 0, false
	}
	if decimalPattern.MatchString(trimmed) {
		parsed, err := strconv.ParseUint(trimmed, 10, 32)
		if err != nil {
			return 0, false
		}
		return uint32(parsed), true
	}
	hex := trimmed
	if strings.HasPrefix(hex, "#") {
		hex = hex[1:]
	} else if strings.HasPrefix(strings.ToLower(hex), "0x") {
		hex = hex[2:]
	}
	if !hexPattern.MatchString(hex) {
		return 0, false
	}
	switch len(hex) {
	case 6:
		parsed, err := strconv.ParseUint(hex, 16, 32)
		if err != nil {
			return 0, false
		}
		return 0xff000000 | uint32(parsed), true
	case 8:
		parsed, err := strconv.ParseUint(hex, 16, 32)
		if err != nil {
			return 0, false
		}
		return uint32(parsed), true
	}
	return 0, false
}
