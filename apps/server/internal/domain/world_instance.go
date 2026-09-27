package domain

const DefaultWorldInstance uint32 = 0x10001

// CharacterWorldInstance reads semantic authority, not a fortress UI state
// or a dungeon region number. Region transitions cannot change this value.
func CharacterWorldInstance(c *Character) uint32 {
	if c != nil && c.World != nil && c.World.PackedInstance != nil {
		return *c.World.PackedInstance
	}
	return DefaultWorldInstance
}
