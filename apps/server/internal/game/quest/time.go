package quest

import (
	"fmt"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/inventory"
	"opensro.online/server/internal/game/item/wire"
)

// 570650 packs hours/minutes, not milliseconds. v1.150 5C2A30 consumes
// days at bit 10, hours at bit 15 and minutes at bit 20.
func packQuestMinutes(minutes uint8) uint32 {
	return uint32(minutes/60)<<15 | uint32(minutes%60)<<20
}

// AdvanceMinute runs only from the admitted character's existing action pulse.
// 922DE0 initializes quest-user +4; 922800 resumes it; 9219A0 decrements
// once, publishes corrections every ten minutes and aborts at zero. Death
// does not stop that pulse. Disconnect removes the actor, preserving the byte.
func (rt *Runtime) AdvanceMinute(c *enterworld.Character) []wire.Frame {
	var out []wire.Frame
	committed := rt.deps.Update(c, "quest-minute", func() bool {
		if c == nil || c.DeletePending {
			return false
		}
		changed := false
		for at := 0; at < len(c.ActiveQuests); {
			record := c.ActiveQuests[at]
			def, ok := rt.Defs.ByRefID(record.RefID)
			if !ok || def.TimeLimitMinutes == 0 {
				at++
				continue
			}
			if record.RemainingMinutes > 0 {
				record.RemainingMinutes--
			}
			if record.RemainingMinutes == 0 {
				// Native automatic abort uses the same mission-item cleanup as
				// cancellation. Plan the complete removal before committing it.
				rows, frames, err := rt.planQuestCleanup(c, def)
				if err != nil {
					// Retain an expired, non-rewardable record if the inventory
					// transaction cannot commit. A later pulse retries cleanup.
					if c.ActiveQuests[at].RemainingMinutes != 0 {
						record.Progress = 0
						record.Flags |= 4
						c.ActiveQuests[at] = record
						delta := record
						delta.Flags = 4
						out = append(out, wire.Frame{Opcode: OpQuestUpdate, Payload: EncodeQuestUpdateUpdate(delta)})
						changed = true
					}
					at++
					continue
				}
				c.MissionInventory = rows
				out = append(out, frames...)
				c.ActiveQuests = append(append([]enterworld.ActiveQuestRecord(nil), c.ActiveQuests[:at]...), c.ActiveQuests[at+1:]...)
				if len(frames) > 0 {
					updates, _ := rt.applyInventoryChange(c)
					out = append(out, updates...)
				}
				out = append(out, wire.Frame{Opcode: OpQuestUpdate, Payload: EncodeQuestUpdateAbandon(record.RefID)})
				if def.TimeoutSymbol != "" {
					out = append(out, wire.Frame{Opcode: 0x36bf, Payload: wire.NewWriter(64).U16(uint16(len(def.TimeoutSymbol))).Bytes([]byte(def.TimeoutSymbol)).Payload()})
				}
				changed = true
				continue
			}
			record.Progress = packQuestMinutes(record.RemainingMinutes)
			record.Flags |= 4
			c.ActiveQuests[at] = record
			if record.RemainingMinutes%10 == 0 {
				delta := record
				delta.Flags = 4
				out = append(out, wire.Frame{Opcode: OpQuestUpdate, Payload: EncodeQuestUpdateUpdate(delta)})
			}
			changed = true
			at++
		}
		return changed
	})
	if !committed {
		return nil
	}
	return out
}

// 923930 removes all stacks of each mission item. Display progress is capped
// at the objective count; cleanup must use inventory truth, including surplus.
func (rt *Runtime) planQuestCleanup(c *enterworld.Character, def *Definition) ([]enterworld.InventoryRow, []wire.Frame, error) {
	codes := make(map[uint32]string)
	for i := 0; i < missionCount(def); i++ {
		m := missionDefinition(def, i)
		if m.Objective == ObjectiveCollect {
			codes[m.CollectItemRefID] = m.CollectItemCodename
		}
	}
	counts := make(map[string]uint32)
	var order []string
	for _, row := range c.MissionInventory {
		code := codes[uint32(row.RefObjID)]
		if code == "" || row.Slot < int64(inventory.EquipmentSlotEnd) || row.Slot >= int64(inventory.BagSlotEnd) {
			continue
		}
		if counts[code] == 0 {
			order = append(order, code)
		}
		counts[code] += uint32(max(row.StackCount, 1))
	}
	var consume []inventory.ItemAmount
	for _, code := range order {
		consume = append(consume, inventory.ItemAmount{Codename: code, Count: counts[code]})
	}
	if def.Objective == ObjectiveDelivery {
		consume = append(consume, deliveryCleanup(c, def)...)
	}
	if len(consume) == 0 {
		return c.MissionInventory, nil, nil
	}
	if rt.PlanInventory == nil {
		return nil, nil, fmt.Errorf("quest cleanup inventory owner unavailable")
	}
	return rt.PlanInventory(c, consume, nil)
}
