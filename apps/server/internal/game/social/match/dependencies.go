package match

import (
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/transport"
)

// Dependencies is the character surface consumed by match listings and joins.
type Dependencies interface {
	domain.CharacterSource
	Read(divisionID string, read func())
	CharacterModelRef(character *domain.Character) uint32
}

// Presence is the live-session directory consumed by match joins and cleanup.
type Presence interface {
	SessionByName(divisionID, name string) (*transport.Session, bool)
}
