package mentor

import "opensro.online/server/internal/domain"

// Dependencies is the authority surface consumed by mentor/camp operations.
type Dependencies interface {
	domain.CharacterSource
	Read(divisionID string, read func())
	TrainingCampAuthority() domain.TrainingCampStore
}
