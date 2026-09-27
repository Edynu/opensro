package enterworld

import (
	"opensro.online/server/internal/domain"
	"strings"
)

func (d *Deps) CharacterByName(division, name string) *Character {
	if d == nil || d.Characters == nil {
		return nil
	}
	if source, ok := d.Characters.(domain.CharacterLookup); ok {
		return source.CharacterByName(division, name)
	}
	for _, c := range d.Characters.CharactersForDivision(division) {
		if c != nil && strings.EqualFold(c.Name, name) {
			return c
		}
	}
	return nil
}
func (d *Deps) CharacterByID(division string, id int64) *Character {
	if d == nil || d.Characters == nil {
		return nil
	}
	if source, ok := d.Characters.(domain.CharacterLookup); ok {
		return source.CharacterByID(division, id)
	}
	for _, c := range d.Characters.CharactersForDivision(division) {
		if c != nil && c.ID == id {
			return c
		}
	}
	return nil
}
