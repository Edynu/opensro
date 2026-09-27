package guild

import "opensro.online/server/internal/domain"

// Dependencies is the authority surface consumed by guild operations.
type Dependencies interface {
	domain.CharacterSource
	Read(divisionID string, read func())
	GuildAuthority() domain.GuildStore
	CharacterModelRef(character *domain.Character) uint32
}
