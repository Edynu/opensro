package domain

import "strings"

const (
	RaceEurope int64 = 0
	RaceChina  int64 = 1

	GenderMale   int64 = 0
	GenderFemale int64 = 1
)

const (
	RaceKeyEurope = "europe"
	RaceKeyChina  = "china"
)

// ResolveCharacterRaceKey resolves the model prefix first and the stored race
// index second.
func ResolveCharacterRaceKey(character *Character) string {
	if character != nil {
		if strings.HasPrefix(character.ModelCodename, "CHAR_CH_") {
			return RaceKeyChina
		}
		if strings.HasPrefix(character.ModelCodename, "CHAR_EU_") {
			return RaceKeyEurope
		}
	}
	if characterRaceIndex(character) == RaceChina {
		return RaceKeyChina
	}
	return RaceKeyEurope
}

// ResolveCharacterRaceIndex is the public numeric form of the same canonical
// identity rule. It exists for boundaries that must expose the legacy numeric
// enum without leaking a stale persisted RaceIndex past a model codename.
func ResolveCharacterRaceIndex(character *Character) int64 {
	if ResolveCharacterRaceKey(character) == RaceKeyChina {
		return RaceChina
	}
	return RaceEurope
}

func characterRaceIndex(character *Character) int64 {
	if character == nil {
		return RaceEurope
	}
	return coerceInt(
		character.RaceIndex,
		RaceEurope,
		RaceChina,
		RaceEurope,
	)
}

func characterGender(character *Character) int64 {
	if character == nil {
		return GenderMale
	}
	return coerceInt(
		character.Gender,
		GenderMale,
		GenderFemale,
		GenderMale,
	)
}

// ResolveCharacterGenderIndex resolves the model identity first and the
// persisted creation index only when the model does not encode a gender.
func ResolveCharacterGenderIndex(character *Character) int64 {
	if character != nil {
		if strings.Contains(character.ModelCodename, "_WOMAN_") {
			return GenderFemale
		}
		if strings.Contains(character.ModelCodename, "_MAN_") {
			return GenderMale
		}
	}
	return characterGender(character)
}

// NativeSexSelector1AC maps the persisted gender to the native character
// selector used by item requirements and the enter-world row.
func NativeSexSelector1AC(character *Character) int {
	if ResolveCharacterGenderIndex(character) == GenderMale {
		return 1
	}
	return 0
}

// NativeCountryByte9C maps the character race to the native country byte.
func NativeCountryByte9C(character *Character) int {
	if ResolveCharacterRaceKey(character) == RaceKeyEurope {
		return 1
	}
	return 0
}

// RaceGenderKey returns the CH_M/EU_W style visual key.
func RaceGenderKey(character *Character, modelCodename string) string {
	var racePrefix string
	switch {
	case strings.HasPrefix(modelCodename, "CHAR_CH_"):
		racePrefix = "CH"
	case strings.HasPrefix(modelCodename, "CHAR_EU_"):
		racePrefix = "EU"
	case ResolveCharacterRaceKey(character) == RaceKeyChina:
		racePrefix = "CH"
	default:
		racePrefix = "EU"
	}

	var genderSuffix string
	switch {
	case strings.Contains(modelCodename, "_WOMAN_"):
		genderSuffix = "W"
	case strings.Contains(modelCodename, "_MAN_"):
		genderSuffix = "M"
	case ResolveCharacterGenderIndex(character) == GenderFemale:
		genderSuffix = "W"
	default:
		genderSuffix = "M"
	}
	return racePrefix + "_" + genderSuffix
}

// ResolveCharacterHeightScale resolves the explicit scale, packed body shape,
// or height index in that order.
func ResolveCharacterHeightScale(character *Character) float64 {
	if character != nil &&
		character.HeightScale != nil &&
		*character.HeightScale > 0 {
		return clampFloat(*character.HeightScale, 0.5, 2)
	}

	var heightIndex int64
	if bodyShape, ok := bodyShapeByte(character); ok {
		heightIndex = bodyShape & 0x0f
	} else {
		heightIndex = coerceInt(charHeightIndex(character), 0, 4, 2)
	}
	return 0.94 + clampFloat(float64(heightIndex), 0, 4)*0.03
}

// ResolveCharacterVolumeScale is the volume half of the same packed shape.
func ResolveCharacterVolumeScale(character *Character) float64 {
	if character != nil &&
		character.VolumeScale != nil &&
		*character.VolumeScale > 0 {
		return clampFloat(*character.VolumeScale, 0.5, 2)
	}

	var volumeIndex int64
	if bodyShape, ok := bodyShapeByte(character); ok {
		volumeIndex = (bodyShape >> 4) & 0x0f
	} else {
		volumeIndex = coerceInt(charVolumeIndex(character), 0, 4, 2)
	}
	return 0.94 + clampFloat(float64(volumeIndex), 0, 4)*0.03
}

func bodyShapeByte(character *Character) (int64, bool) {
	if character == nil {
		return 0, false
	}
	return coerceOptionalInt(character.BodyShapeByte, 0, 0xff)
}

func charHeightIndex(character *Character) *int64 {
	if character == nil {
		return nil
	}
	return character.HeightIndex
}

func charVolumeIndex(character *Character) *int64 {
	if character == nil {
		return nil
	}
	return character.VolumeIndex
}

const nativeCharacterCameraHeightBase = 20

// ResolveCharacterCameraHeight returns the scaled native camera height.
func ResolveCharacterCameraHeight(character *Character) float64 {
	return ResolveCharacterHeightScale(character) *
		nativeCharacterCameraHeightBase
}

// StartProfileSpec is one race-owned starting position and fallback model set.
type StartProfileSpec struct {
	RaceIndex               int64
	RegionID                int64
	X, Y, Z                 float64
	Angle                   int64
	DefaultModelRefByGender map[int64]uint32
}

var startProfilesByRace = map[string]StartProfileSpec{
	RaceKeyEurope: {
		RaceIndex: RaceEurope,
		RegionID:  0x6b4f,
		X:         1205,
		Y:         80,
		Z:         396,
		Angle:     0,
		DefaultModelRefByGender: map[int64]uint32{
			GenderMale:   14726,
			GenderFemale: 14738,
		},
	},
	RaceKeyChina: {
		RaceIndex: RaceChina,
		RegionID:  0x62a8,
		X:         960.418884,
		Y:         20,
		Z:         458.259766,
		Angle:     0,
		DefaultModelRefByGender: map[int64]uint32{
			GenderMale:   1907,
			GenderFemale: 1920,
		},
	},
}

// StartProfileForRace returns the race profile, defaulting to Europe for an
// unknown race key.
func StartProfileForRace(raceKey string) StartProfileSpec {
	profile, ok := startProfilesByRace[raceKey]
	if !ok {
		profile = startProfilesByRace[RaceKeyEurope]
	}
	models := make(map[int64]uint32, len(profile.DefaultModelRefByGender))
	for gender, modelRef := range profile.DefaultModelRefByGender {
		models[gender] = modelRef
	}
	profile.DefaultModelRefByGender = models
	return profile
}

// DefaultModelRefForRaceGender resolves a model and defaults to the male
// model when the gender value is outside the native enum.
func DefaultModelRefForRaceGender(raceKey string, gender int64) uint32 {
	profile := StartProfileForRace(raceKey)
	if ref, ok := profile.DefaultModelRefByGender[gender]; ok {
		return ref
	}
	return profile.DefaultModelRefByGender[GenderMale]
}
