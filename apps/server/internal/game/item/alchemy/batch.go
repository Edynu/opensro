package alchemy

import "opensro.online/server/internal/game/item/inventory"

// CompoundSteps turns the v1.150 total into ordered, single-stack transactions.
// The optional leading Rondo is carried by the v1.150 form; later servers scan
// the bag for Rondo instead. Every requested row is admitted before the first
// step, but capacity and reagent availability are rechecked at each commit.
func (c *Catalog) CompoundSteps(items []inventory.Item, request ProcessRequest) ([]ProcessRequest, error) {
	if request.Cancel || len(request.Slots) == 0 || len(request.Slots) > 9 {
		return nil, Refusal(0x10)
	}
	rows, err := c.processInputs(items, request)
	if err != nil {
		return nil, err
	}
	if request.Mode == 2 {
		if request.Quantity != 1 || len(request.Slots) != 5 {
			return nil, Refusal(0x10)
		}
		return []ProcessRequest{request}, nil
	}
	if request.Mode != 1 || request.Quantity == 0 {
		return nil, Refusal(0x10)
	}
	slots := request.Slots
	if len(slots) > 0 && rows[slots[0]].Codename == "ITEM_ETC_ARCHEMY_RONDO_01" {
		slots = slots[1:]
	}
	if len(slots) == 0 {
		return nil, Refusal(6)
	}
	left := request.Quantity
	var steps []ProcessRequest
	for _, slot := range slots {
		item := rows[slot]
		if c.Items[item.Codename].Flags&0xfffe != 0x25ec {
			return nil, Refusal(6)
		}
		quantity := min(left, uint32(item.Quantity))
		if quantity > 0 {
			steps = append(steps, ProcessRequest{Mode: 1, Quantity: quantity, Slots: []uint8{slot}})
			left -= quantity
		}
	}
	if left != 0 {
		return nil, Refusal(6)
	}
	return steps, nil
}
