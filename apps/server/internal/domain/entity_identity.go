package domain

// Server-owned entity identity bands. The original port declared only base
// values, so monotonically increasing ground and monster counters eventually
// crossed into their sister plane. These ceilings make the partition real.
// The COS range follows the pinned browser-client fixture convention
// (0x00C0xxxx) and leaves a large monster range below it.
const (
	PlayerGIDBase      uint32 = 100000
	NPCGIDBase         uint32 = 200000
	GroundItemGIDBase  uint32 = 300000
	GroundItemGIDLimit uint32 = 399999
	MonsterGIDBase     uint32 = 400000
	MonsterGIDLimit    uint32 = 0x00BFFFFF
	COSGIDBase         uint32 = 0x00C00000
	COSGIDLimit        uint32 = 0x00FFFFFF
)

const (
	MaxGroundItemGIDCounter = GroundItemGIDLimit - GroundItemGIDBase
	MaxMonsterGIDCounter    = MonsterGIDLimit - MonsterGIDBase
	MaxCOSOwnerID           = COSGIDLimit - COSGIDBase
)
