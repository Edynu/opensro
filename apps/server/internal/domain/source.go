package domain

// DefaultDivisionID is the dev/test fallback when no shard catalog is loaded.
// It matches the shipped default row in config/shards.json.
const DefaultDivisionID = "global-official"

// TestDivisionID is the shipped development catalog's secondary shard id.
const TestDivisionID = "test"

// CharacterSource exposes the authoritative characters of one division.
// Implementations must return the live record pointers: store mutation and
// gameplay lanes deliberately share object identity.
type CharacterSource interface {
	CharactersForDivision(divisionID string) []*Character
}

// CharacterLookup is an optional indexed identity facet. Returned pointers
// have the same lifetime/read-door contract as CharacterSource records.
type CharacterLookup interface {
	CharacterByName(divisionID, name string) *Character
	CharacterByID(divisionID string, id int64) *Character
}
