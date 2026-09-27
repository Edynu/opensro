package store

import "opensro.online/server/internal/domain"

// ReadCharacterSelection projects deletion blockers and characters under one
// read lock. The callback follows ReadCharacters' borrowing contract and must
// not reenter the store. These blockers are presentation, not mutation authority:
// ReserveCharacterDeletion still checks membership at the commit boundary.
func (s *Store) ReadCharacterSelection(divisionID string, fn func([]*domain.Character, map[int64]string)) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	roles := make(map[int64]string)
	for _, members := range s.campMembers[divisionID] {
		for _, member := range members {
			role := "academy-student"
			if member.Kind < 2 {
				role = "academy-guardian"
			}
			roles[member.CharID] = role
		}
	}
	// SRO_Client 0x735F50 gives guild membership priority over academy.
	for _, members := range s.guildMembers[divisionID] {
		for _, member := range members {
			role := "guild-member"
			if member.Grade == 0 {
				role = "guild-master"
			}
			roles[member.CharID] = role
		}
	}
	rows := append([]*domain.Character(nil), s.characters[divisionID]...)
	fn(rows, roles)
}
