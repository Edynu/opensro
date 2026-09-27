package enterworld

import "opensro.online/server/internal/game/item/wire"

// CharacterTransformSkin projects the character's transform block onto the
// wire (0x323A and the spawn row). A Duplicate's skin is a player skin.
func CharacterTransformSkin(c *Character) wire.TransformSkin {
	if c == nil || c.TransformRefObjID == 0 {
		return wire.TransformSkin{}
	}
	skin := wire.TransformSkin{RefObjID: c.TransformRefObjID}
	if c.TransformMode == 2 {
		skin.Player, skin.Shape, skin.Equipment = true, c.TransformShape, c.TransformEquipment
	}
	return skin
}
