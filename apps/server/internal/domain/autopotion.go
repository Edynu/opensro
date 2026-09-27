package domain

// AutoPotionSettings is the v1.150 7783E0 / 70C3D0 packed configuration.
// Keep wire values intact in storage: the client owns default substitution.
type AutoPotionSettings struct {
	HP     uint16 `json:"hp"`
	MP     uint16 `json:"mp"`
	Cure   uint16 `json:"cure"`
	Timing uint8  `json:"timing"`
}
