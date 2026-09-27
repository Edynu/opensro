package quest

import (
	"errors"
	"fmt"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/inventory"
	"opensro.online/server/internal/game/item/wire"
)

type dialogueRefusal struct {
	cause  error
	symbol string
}

func (e *dialogueRefusal) Error() string          { return e.cause.Error() }
func (e *dialogueRefusal) Unwrap() error          { return e.cause }
func (e *dialogueRefusal) DialogueSymbol() string { return e.symbol }

func inventoryRefusal(def *Definition, err error) error {
	var fault *inventory.Fault
	if errors.As(err, &fault) && fault.Code == wire.ErrCodeStorageFull && def.InventoryFullSymbol != "" {
		return &dialogueRefusal{err, def.InventoryFullSymbol}
	}
	return err
}

// AdvanceNpcQuest receives the NPC identity from action's selection-bound
// conversation. The client cannot substitute an intermediate delivery NPC.
func (rt *Runtime) AdvanceNpcQuest(c *enterworld.Character, code, npc string) (OpResult, error) {
	base, stage, staged := parseStageToken(code)
	def, ok := rt.Defs.ByCodename(base)
	if !ok {
		return OpResult{}, fmt.Errorf("unknown NPC quest %s", code)
	}
	if len(def.Stages) > 0 {
		if !staged {
			return OpResult{}, fmt.Errorf("stage-bound NPC confirmation required")
		}
		return rt.completeRewardAt(c, def, &stage, npc)
	}
	if staged {
		return OpResult{}, fmt.Errorf("unexpected quest stage token")
	}
	if def.DeliveryNpcCodename != "" && npc == def.DeliveryNpcCodename {
		return rt.collectDelivery(c, def)
	}
	if npc == "" || npc != def.EndNpcCodename {
		return OpResult{}, fmt.Errorf("quest %s wrong completion NPC", code)
	}
	return rt.CompleteNpcQuest(c, code)
}

func (rt *Runtime) collectDelivery(c *enterworld.Character, def *Definition) (OpResult, error) {
	if rt.PlanInventory == nil {
		return OpResult{}, fmt.Errorf("delivery inventory owner unavailable")
	}
	var refusal error
	var frames []wire.Frame
	changed := rt.deps.Update(c, "quest-delivery", func() bool {
		if c == nil || c.DeletePending || activeQuestIndex(c, def.RefID) < 0 {
			refusal = fmt.Errorf("delivery quest is not active")
			return false
		}
		held := heldCollectCount(c, def)
		if held >= def.CollectCount {
			refusal = fmt.Errorf("delivery item already held")
			return false
		}
		rows, updates, err := rt.PlanInventory(c, nil, []inventory.ItemAmount{{Codename: def.CollectItemCodename, Count: def.CollectCount - held}})
		if err != nil {
			refusal = inventoryRefusal(def, err)
			return false
		}
		c.MissionInventory = rows
		objectives, _ := rt.applyInventoryChange(c)
		frames = append(updates, objectives...)
		return true
	})
	if refusal != nil {
		return OpResult{}, refusal
	}
	if !changed {
		return OpResult{}, fmt.Errorf("delivery character no longer authoritative")
	}
	return OpResult{Frames: frames}, nil
}
