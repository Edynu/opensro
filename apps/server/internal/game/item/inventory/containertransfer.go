package inventory

import "opensro.online/server/internal/game/item/wire"

// TransferWholeTo applies a whole-source transfer between bag owners. Native
// 756CF0 supplies the source count to 756A60 for both COS directions: compatible
// stacks merge (including the full-destination count exchange), otherwise swap.
func (inv *Inventory) TransferWholeTo(destination *Inventory, sourceSlot, destinationSlot uint8, stackCap uint16) *Fault {
	if destination == nil || destination == inv || !inv.bagSlot(sourceSlot) || !destination.bagSlot(destinationSlot) {
		return newFault(wire.ErrCodeInvalidRequest, "invalidContainerTransfer")
	}
	i := inv.indexOf(sourceSlot)
	if i < 0 {
		return newFault(wire.ErrCodeInvalidRequest, "unavailableContainerSlot")
	}
	j := destination.indexOf(destinationSlot)
	if j >= 0 {
		source, target := inv.items[i], destination.items[j]
		if IsEtcStackableTypeFlags(source.TypeFlags) && source.RefObjID == target.RefObjID {
			if stackCap == 0 || source.Quantity == 0 || target.Quantity == 0 || source.Quantity > stackCap || target.Quantity > stackCap {
				return newFault(wire.ErrCodeInvalidRequest, "invalidContainerStack")
			}
			counts := TransferSlotStack(source.Quantity, target.Quantity, stackCap)
			destination.items[j].Quantity = counts.DestCount
			if counts.SourceRemainder == 0 {
				inv.items = append(inv.items[:i], inv.items[i+1:]...)
			} else {
				inv.items[i].Quantity = counts.SourceRemainder
			}
		} else {
			source.Slot = destinationSlot
			target.Slot = sourceSlot
			source.MagicOptions = append([]uint64(nil), source.MagicOptions...)
			target.MagicOptions = append([]uint64(nil), target.MagicOptions...)
			inv.items[i] = target
			destination.items[j] = source
		}
		return nil
	}
	row := inv.items[i]
	row.Slot = destinationSlot
	row.MagicOptions = append([]uint64(nil), row.MagicOptions...)
	destination.items = append(destination.items, row)
	inv.items = append(inv.items[:i], inv.items[i+1:]...)
	return nil
}
