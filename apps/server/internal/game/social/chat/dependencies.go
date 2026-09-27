package chat

import "opensro.online/server/internal/domain"

// Dependencies is the authority surface consumed by chat routing.
type Dependencies interface {
	domain.CharacterSource
	Read(divisionID string, read func())
	GuildAuthority() domain.GuildStore
}
