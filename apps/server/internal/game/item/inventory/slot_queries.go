package inventory

// These range primitives project the storage-operator slot scans, not the
// higher-level equipment/transaction gates. End is exclusive; only CountSlots
// accepts -1 as capacity (research server 4BA500).
func (inv *Inventory) CountSlots(start, end, occupied int32) int32 {
	if end == -1 {
		end = int32(inv.slotEnd)
	}
	if start < 0 || end > int32(inv.slotEnd) {
		return 0
	}
	var count int32
	for i := start; i < end; i++ {
		_, found := inv.At(uint8(i))
		if found && occupied == 1 || !found && occupied == 0 {
			count++
		}
	}
	return count
}

// FirstOccupied projects 4BA090. Failure always writes the native 0xff sentinel.
func (inv *Inventory) FirstOccupied(start, end int32) (Item, uint8, bool) {
	if start < 0 || end > int32(inv.slotEnd) {
		return Item{}, 255, false
	}
	for i := start; i < end; i++ {
		if row, ok := inv.At(uint8(i)); ok {
			return row, uint8(i), true
		}
	}
	return Item{}, 255, false
}

// HasItemFrom projects 4BA590, including its negative-start clamp.
func (inv *Inventory) HasItemFrom(start int32) bool {
	if start < 0 {
		start = 0
	}
	_, _, found := inv.FirstOccupied(start, int32(inv.slotEnd))
	return found
}

// FirstEmpty projects the scan in 4B9F20. Its caller must select the allowed
// start for the storage kind (13 for a player bag, zero for plain storage).
func (inv *Inventory) FirstEmpty(start int32) (uint8, bool) {
	if start < 0 {
		return 255, false
	}
	for i := start; i < int32(inv.slotEnd); i++ {
		if _, ok := inv.At(uint8(i)); !ok {
			return uint8(i), true
		}
	}
	return 255, false
}
