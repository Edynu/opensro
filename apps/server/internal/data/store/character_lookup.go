package store

import (
	"opensro.online/server/internal/domain"
	"strings"
	"unicode"
)

type characterLookupIndex struct {
	names map[string]*domain.Character
	ids   map[int64]*domain.Character
}

// Match strings.EqualFold, including Unicode simple-fold cycles. First source
// row wins, exactly as the former linear lookup did for ambiguous fixtures.
func characterLookupName(name string) string {
	var key strings.Builder
	key.Grow(len(name))
	for _, r := range name {
		least := r
		for next := unicode.SimpleFold(r); next != r; next = unicode.SimpleFold(next) {
			if next < least {
				least = next
			}
		}
		key.WriteRune(least)
	}
	return key.String()
}

// Published indexes are immutable. Only Store owns construction/invalidation;
// character fields still require the normal authority read or mutation door.
func (s *Store) characterLookup(division string) *characterLookupIndex {
	s.mu.RLock()
	index := s.characterLookups[division]
	s.mu.RUnlock()
	if index != nil {
		return index
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if index = s.characterLookups[division]; index != nil {
		return index
	}
	index = &characterLookupIndex{names: make(map[string]*domain.Character), ids: make(map[int64]*domain.Character)}
	for _, c := range s.characters[division] {
		if c == nil {
			continue
		}
		key := characterLookupName(c.Name)
		if index.names[key] == nil {
			index.names[key] = c
		}
		if index.ids[c.ID] == nil {
			index.ids[c.ID] = c
		}
	}
	if s.characterLookups == nil {
		s.characterLookups = make(map[string]*characterLookupIndex)
	}
	s.characterLookups[division] = index
	return index
}

func (src storeCharacterSource) CharacterByName(division, name string) *domain.Character {
	return src.s.characterLookup(division).names[characterLookupName(name)]
}
func (src storeCharacterSource) CharacterByID(division string, id int64) *domain.Character {
	return src.s.characterLookup(division).ids[id]
}
