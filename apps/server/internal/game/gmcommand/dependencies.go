package gmcommand

import "opensro.online/server/internal/domain"

// Dependencies is the character lookup surface consumed by GM commands.
type Dependencies interface {
	domain.CharacterSource
	Read(divisionID string, read func())
}
