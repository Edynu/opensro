package quest

import (
	"fmt"
	"math"
	"sync"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/inventory"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/calendar"
)

// Runtime is the quest lane's authority core: definition lookups, the
// per-character quest-state mutations (all through the bootstrap Mutate
// door - the community whisper-block posture), and the 0x31ED emission
// per mutation.
//
// OP-3 VS OP-4 (the declared choice the wire constants reference): the
// client's sub_75c1d0 treats ops 3 and 4 as ONE jump-table leg, so the
// split is unobservable client-side. This server emits op 3 for a
// REWARD TURN-IN (0x729A: active list -> completed list, rewards paid)
// and op 4 for a GIVE-UP (0x71EB: active list -> gone; NOT appended to
// CompletedQuestIds, so the quest is re-acceptable after re-enter).
// Rationale: the byte is free, the native handler's own comment split
// ("complete / abandon") survives into wire logs and future captures,
// and the PERSISTED asymmetry (completed-append vs plain removal) is
// the actual semantic difference - mid-session the client appends its
// local completed list on BOTH ops (native behavior), which the next
// enter-world 0x32B3 seed corrects from the persisted truth.
type Runtime struct {
	CalendarNow    func() calendar.Value
	calendarMu     sync.Mutex
	periodStarts   map[uint32]uint32
	calendarHour   uint8
	calendarNextMs int64
	PlanInventory  func(*enterworld.Character, []inventory.ItemAmount, []inventory.ItemAmount) ([]enterworld.InventoryRow, []wire.Frame, error)
	deps           Dependencies
	Defs           *Definitions
	// ApplyExperience is the progression progression updater used inside the
	// quest-reward authority transaction. It opens no door itself, allowing
	// quest completion, gold, and experience to commit atomically.
	ApplyExperience func(character *enterworld.Character, expDelta, skillExpDelta int64, sourceGid uint32) ([]wire.Frame, bool)
}

// OpResult is one handled operation's answer for the acting session plus
// any public presentation projection contributed by its progression reward.
// Quest state, gold, stats, SP and EXP remain private; only the gid-bearing
// level-up effect may fan out.
type OpResult struct {
	Frames    []wire.Frame
	Broadcast []wire.Frame
}

// NewRuntime builds the lane core. Refuses (loud, typed) when the loaded
// definitions pay experience but no granter is wired - a turn-in that
// silently dropped its evidenced reward would be a lie shaped like
// success.
func NewRuntime(
	deps Dependencies,
	defs *Definitions,
	applyExperience func(*enterworld.Character, int64, int64, uint32) ([]wire.Frame, bool),
) (*Runtime, error) {
	if defs == nil {
		return nil, fmt.Errorf("quest runtime: nil definitions")
	}
	if applyExperience == nil {
		for _, def := range defs.All() {
			for _, stage := range def.Stages {
				if stage.RewardExp > 0 || stage.RewardSkillExp > 0 {
					return nil, fmt.Errorf("quest %s stage requires experience granter", def.Codename)
				}
			}
			if def.RewardExp > 0 || def.RewardSkillExp > 0 {
				return nil, fmt.Errorf("quest runtime: definition %s pays %d exp but no exp granter is wired (progression GrantExperience)", def.Codename, def.RewardExp)
			}
		}
	}
	rt := &Runtime{deps: deps, Defs: defs, ApplyExperience: applyExperience, CalendarNow: calendar.Current, periodStarts: make(map[uint32]uint32)}
	for _, def := range defs.All() {
		rt.periodStarts[def.RefID] = def.PeriodStartLimit
	}
	return rt, nil
}

// BuildActiveQuestRecord composes the wire/persistence record for one
// definition at a given collect progress. The flag set is 0x08|0x10
// (kind byte + contents), the two facets the definitions carry:
//
//   - NO flags&0x04 progress word: the client record keeps the ctor
//     0xffffffff sentinel and the pane paints UIIT_STT_QUEST_UNLIMITED
//     for untimed definitions. Timed definitions publish the native packed
//     duration and persist their independent remaining-minute counter.
//   - U08 carries the run/limit nibble pair consumed by native 5c4087.
//     U09 retains the existing neutral colorbar policy.
//   - One contents node, tag 1, description = the shipped SN_CON_*
//     symbol. Collect objectives carry [progress] as the single %d
//     argument (the shipped strings format exactly one %d); talk
//     objectives carry the 0xFF no-array sentinel. The node kind byte
//     is 1 (UIIT_STT_QUEST_ING paint) while unfinished, 0
//     (UIIT_STT_QUEST_END) once the objective is met.
func BuildActiveQuestRecord(def *Definition, progress uint32) enterworld.ActiveQuestRecord {
	if len(def.Stages) > 0 {
		def, _ = definitionAtStage(def, 0)
	}
	if def.Objective == ObjectiveParallel {
		record := enterworld.ActiveQuestRecord{RefID: def.RefID, Stage: def.stageIndex, U08: repeatTitleByte(def, 0), Flags: 0x08 | 0x10, U10: def.KindByte}
		for i := 0; i < missionCount(def); i++ {
			record.Contents = append(record.Contents, BuildActiveQuestRecord(missionDefinition(def, i), 0).Contents...)
		}
		return record
	}
	node := enterworld.ActiveQuestContentsNode{
		Tag:         def.missionIndex + 1,
		Kind:        1,
		Description: def.ContentsSymbol,
	}
	switch def.Objective {
	case ObjectiveCollect, ObjectiveKill:
		if progress > objectiveRequired(def) {
			progress = objectiveRequired(def)
		}
		if progress >= objectiveRequired(def) {
			node.Kind = 0
			node.CompletionReached = true
		}
		node.ObjectiveValues = []uint32{progress}
	default:
		node.ObjectiveSentinel = true
	}
	return enterworld.ActiveQuestRecord{
		RefID:    def.RefID,
		Stage:    def.stageIndex,
		U08:      repeatTitleByte(def, 0),
		Flags:    0x08 | 0x10,
		U10:      def.KindByte,
		Contents: []enterworld.ActiveQuestContentsNode{node},
	}
}

// activeQuestIndex finds refID in the character's active list (the
// caller must hold the record inside a Mutate/Read door when the list
// can move).
func activeQuestIndex(character *enterworld.Character, refID uint32) int {
	for index, record := range character.ActiveQuests {
		if record.RefID == refID {
			return index
		}
	}
	return -1
}

// questCompleted reports whether refID sits on the persisted completed
// list.
func questCompleted(character *enterworld.Character, refID uint32) bool {
	for _, id := range character.CompletedQuestIds {
		if id == refID {
			return true
		}
	}
	return false
}

// Inventory truth is rechecked at the authority boundary. Persisted counters
// are a projection and can be stale after a catalog correction or item change.
func objectiveMet(c *enterworld.Character, def *Definition, record enterworld.ActiveQuestRecord) bool {
	if def.TimeLimitMinutes > 0 && record.RemainingMinutes == 0 {
		return false
	}
	switch def.Objective {
	case ObjectiveParallel:
		if len(def.Objectives) < 2 {
			return false
		}
		for i := range def.Objectives {
			m := missionDefinition(def, i)
			if !objectiveMet(c, m, missionRecord(record, m)) {
				return false
			}
		}
		return true
	case ObjectiveTalk:
		return true
	case ObjectiveDelivery:
		return deliveryMet(c, def)
	case ObjectiveCollect:
		return heldCollectCount(c, def) >= def.CollectCount
	case ObjectiveKill:
		return recordProgress(record) >= def.KillCount
	default:
		return false
	}
}

// heldCollectCount sums the character's inventory stacks of the
// definition's collect item. Callers run it INSIDE the Mutate door (the
// inventory rows are mutable record state).
func heldCollectCount(character *enterworld.Character, def *Definition) uint32 {
	var held int64
	for _, row := range character.MissionInventory {
		if row.Slot >= int64(inventory.EquipmentSlotEnd) && row.Slot < int64(inventory.BagSlotEnd) && row.RefObjID == def.CollectItemRefID {
			count := row.StackCount
			if count < 1 {
				// A present row with no stack word is one item (the
				// equip rows' shape).
				count = 1
			}
			held += count
		}
	}
	if held < 0 {
		return 0
	}
	if held > int64(def.CollectCount) {
		return def.CollectCount
	}
	return uint32(held)
}

// recordProgress reads the collect counter back out of a persisted
// record (the single %d objective value BuildActiveQuestRecord wrote).
func recordProgress(record enterworld.ActiveQuestRecord) uint32 {
	if len(record.Contents) == 0 || len(record.Contents[0].ObjectiveValues) == 0 {
		return 0
	}
	return record.Contents[0].ObjectiveValues[0]
}

// StartQuest accepts a quest onto the character: the explicit
// server-side mutation (a future NPC-talk quest-offer plane calls this
// same core; today's callers are the creation seed - which bypasses it
// by seeding the record directly, seed.go - and tests). Refuses (typed,
// loud) an unknown codename, an already-active and an already-completed
// quest. Success answers the 0x31ED op-1 insert.
func (rt *Runtime) StartQuest(character *enterworld.Character, codename string) (OpResult, error) {
	if character == nil {
		return OpResult{}, fmt.Errorf("quest start: nil character")
	}
	def, ok := rt.Defs.ByCodename(codename)
	if !ok {
		return OpResult{}, fmt.Errorf("quest start: codename %s has no loaded definition", codename)
	}

	var refusal error
	var record enterworld.ActiveQuestRecord
	var inventoryFrames []wire.Frame
	changed := rt.deps.Update(character, "quest-start", func() bool {
		rt.calendarMu.Lock()
		defer rt.calendarMu.Unlock()
		if !rt.calendarAvailableLocked(def, false) {
			refusal = fmt.Errorf("quest start: %s calendar condition unavailable", codename)
			return false
		}
		if character.DeletePending {
			refusal = fmt.Errorf("quest start: character is pending deletion")
			return false
		}
		if activeQuestIndex(character, def.RefID) >= 0 {
			refusal = fmt.Errorf("quest start: %s (id %d) is already active", codename, def.RefID)
			return false
		}
		// The native login sections carry u8 counts. Never accept a record
		// which would disappear behind the login composer's 255-row boundary.
		if len(character.ActiveQuests) >= 255 {
			refusal = fmt.Errorf("quest start: active quest wire capacity reached")
			return false
		}
		if !canAcceptAgain(character, def) {
			refusal = fmt.Errorf("quest start: %s (id %d) is already completed", codename, def.RefID)
			return false
		}
		if !prerequisitesMet(character, def) {
			refusal = fmt.Errorf("quest start: %s prerequisites are incomplete", codename)
			return false
		}
		level := int64(1)
		if character.Level != nil {
			level = *character.Level
		}
		if level < int64(def.Level) || (def.CountryByte != 3 && int(def.CountryByte) != enterworld.NativeCountryByte9C(character)) {
			refusal = fmt.Errorf("quest start: %s is unavailable for this level/country", codename)
			return false
		}
		if def.Objective == ObjectiveDelivery {
			if rt.PlanInventory == nil {
				refusal = fmt.Errorf("delivery inventory owner unavailable")
				return false
			}
			rows, frames, err := rt.PlanInventory(character, nil, deliveryAmounts(def))
			if err != nil {
				refusal = inventoryRefusal(def, err)
				return false
			}
			character.MissionInventory = rows
			inventoryFrames = frames
		}
		progress := uint32(0)
		if def.Objective == ObjectiveCollect {
			// A collect quest accepted while the character already
			// holds objective items starts at the held count (the
			// recompute-from-inventory rule the action hook keeps).
			progress = heldCollectCount(character, def)
		}
		record = BuildActiveQuestRecord(def, progress)
		if def.TimeLimitMinutes > 0 {
			record.RemainingMinutes = def.TimeLimitMinutes
			record.Progress = packQuestMinutes(record.RemainingMinutes)
			record.Flags |= 4
		}
		record, _ = refreshMissions(character, def, record, "", 0)
		record.U08 = repeatTitleByte(def, completionCount(character, def.RefID))
		next := make([]enterworld.ActiveQuestRecord, 0, len(character.ActiveQuests)+1)
		next = append(next, character.ActiveQuests...)
		next = append(next, record)
		character.ActiveQuests = next
		if def.Objective == ObjectiveDelivery {
			updates, _ := rt.applyInventoryChange(character)
			inventoryFrames = append(inventoryFrames, updates...)
		}
		if def.PeriodStartLimit > 0 {
			rt.periodStarts[def.RefID]--
		}
		return true
	})
	if refusal != nil {
		return OpResult{}, refusal
	}
	if !changed {
		return OpResult{}, fmt.Errorf("quest start: character is no longer authoritative")
	}
	return OpResult{Frames: append(inventoryFrames, wire.Frame{Opcode: OpQuestUpdate, Payload: EncodeQuestUpdateInsert(record)})}, nil
}

// NpcOption is the quest-owned semantic row projected through action' dialog
// port. Symbols remain client-localized; no server prose crosses the wire.
type NpcOption struct {
	Codename, TitleSymbol, PromptSymbol      string
	AcceptResponseSymbol, DenyResponseSymbol string
	Informational                            bool
	Complete                                 bool
}

// OptionsForNpc returns active talk turn-ins first, then available offers.
// The caller holds the character read door; this method is pure.
func (rt *Runtime) OptionsForNpc(character *enterworld.Character, npcCodename string) []NpcOption {
	if character == nil || character.DeletePending {
		return nil
	}
	country := enterworld.NativeCountryByte9C(character)
	level := int64(1)
	if character.Level != nil {
		level = *character.Level
	}
	var completes, offers []NpcOption
	for _, def := range rt.Defs.All() {
		if def.StartNpcCodename == "" || (def.CountryByte != 3 && int(def.CountryByte) != country) || int64(def.Level) > level {
			continue
		}
		active := activeQuestIndex(character, def.RefID) >= 0
		if active && len(def.Stages) > 0 {
			record := character.ActiveQuests[activeQuestIndex(character, def.RefID)]
			current, ok := definitionAtStage(def, record.Stage)
			if ok && current.EndNpcCodename == npcCodename && stageObjectiveMet(character, current, record) {
				completes = append(completes, NpcOption{Codename: stageToken(def.Codename, record.Stage), TitleSymbol: def.TitleSymbol, PromptSymbol: current.CompletePromptSymbol, Complete: true})
			}
			continue
		}
		if active && def.DeliveryNpcCodename == npcCodename && npcCodename != "" && heldCollectCount(character, def) < def.CollectCount {
			completes = append(completes, NpcOption{Codename: def.Codename, TitleSymbol: def.TitleSymbol, PromptSymbol: def.DeliveryPromptSymbol, Complete: true})
			continue
		}

		if active && def.EndNpcCodename == npcCodename && (def.Objective == ObjectiveTalk || objectiveMet(character, def, character.ActiveQuests[activeQuestIndex(character, def.RefID)])) {
			completes = append(completes, NpcOption{
				Codename: def.Codename, TitleSymbol: def.TitleSymbol,
				PromptSymbol: def.CompletePromptSymbol, Complete: true,
			})
			continue
		}
		if !active && canAcceptAgain(character, def) && prerequisitesMet(character, def) && rt.calendarAvailable(def, false) && def.StartNpcCodename == npcCodename {
			prompt := def.OfferPromptSymbol
			// Native 9206ec..92073f: DifferentString only selects the
			// after-one-clear offer when the persisted completion count > 0.
			if def.RepeatOfferPromptSymbol != "" && completionCount(character, def.RefID) > 0 {
				prompt = def.RepeatOfferPromptSymbol
			}
			offers = append(offers, NpcOption{
				Codename: def.Codename, TitleSymbol: def.TitleSymbol,
				PromptSymbol:         prompt,
				AcceptResponseSymbol: def.AcceptResponseSymbol, DenyResponseSymbol: def.DenyResponseSymbol,
			})
		}
		if active && def.EndNpcCodename == npcCodename && def.NotAchievedSymbol != "" {
			completes = append(completes, NpcOption{Codename: def.Codename, TitleSymbol: def.TitleSymbol, PromptSymbol: def.NotAchievedSymbol, Informational: true})
		}
	}
	return append(completes, offers...)
}

// CompleteTalkQuest uses the same atomic reward owner as combat/collection quests.
func (rt *Runtime) CompleteTalkQuest(character *enterworld.Character, codename string) (OpResult, error) {
	def, ok := rt.Defs.ByCodename(codename)
	if !ok || def.Objective != ObjectiveTalk {
		return OpResult{}, fmt.Errorf("quest talk complete: invalid objective %s", codename)
	}
	return rt.completeReward(character, def)
}

// HandleGiveUp is the 0x71EB core: strict-decode the refId, validate it
// against the LOADED definitions (an unknown id refuses with a typed
// error - the register layer logs it and sends the native refusal envelope),
// require the quest active and its kind give-up-able (1/7/8 - the same
// kinds whose window can compose the packet, sub_5c26e0), then remove
// it from the active list WITHOUT a completed append and answer the
// 0x31ED op-4 abandon.
func (rt *Runtime) HandleGiveUp(character *enterworld.Character, payload []byte) (OpResult, error) {
	refID, err := DecodeQuestRefRequest(payload)
	if err != nil {
		return OpResult{}, err
	}
	def, ok := rt.Defs.ByRefID(refID)
	if !ok {
		return OpResult{}, fmt.Errorf("quest give-up: id %d has no loaded definition", refID)
	}
	if def.KindByte == 2 {
		// The kind-2 window's button composes 0x729A, never 0x71EB
		// (sub_5c2440 @0x005c2465): a give-up for a reward-kind quest
		// is a crafted frame.
		return OpResult{}, fmt.Errorf("quest give-up: %s (id %d) is kind 2 (reward) - the client cannot compose 0x71EB for it", def.Codename, refID)
	}

	var refusal error
	var inventoryFrames []wire.Frame
	changed := rt.deps.Update(character, "quest-giveup", func() bool {
		if character == nil || character.DeletePending {
			refusal = fmt.Errorf("quest give-up: character unavailable")
			return false
		}
		at := activeQuestIndex(character, refID)
		if at < 0 {
			refusal = fmt.Errorf("quest give-up: %s (id %d) is not active", def.Codename, refID)
			return false
		}
		if len(def.Stages) > 0 && character.ActiveQuests[at].Stage > 0 {
			refusal = fmt.Errorf("quest tutorial already advanced; abandonment would reset paid stages")
			return false
		}
		rows, frames, err := rt.planQuestCleanup(character, def)
		if err != nil {
			refusal = err
			return false
		}
		character.MissionInventory, inventoryFrames = rows, frames
		next := make([]enterworld.ActiveQuestRecord, 0, len(character.ActiveQuests)-1)
		next = append(next, character.ActiveQuests[:at]...)
		next = append(next, character.ActiveQuests[at+1:]...)
		character.ActiveQuests = next
		objectives, _ := rt.applyInventoryChange(character)
		inventoryFrames = append(inventoryFrames, objectives...)
		rt.releasePeriodStart(def)
		return true
	})
	if refusal != nil {
		return OpResult{}, refusal
	}
	if !changed {
		return OpResult{}, fmt.Errorf("quest give-up: character is no longer authoritative")
	}
	return OpResult{Frames: append(inventoryFrames, wire.Frame{Opcode: OpQuestUpdate, Payload: EncodeQuestUpdateAbandon(refID)})}, nil
}

// HandleRewardSelect is the 0x729A core: strict-decode, validate against
// the loaded definitions, require the quest active, kind 2 (the only
// kind whose window composes the packet) and its objective MET, then
// turn it in - remove from the active list, append the completed list,
// pay the evidenced gold through the record door and the evidenced exp
// through the progression core - and answer 0x31ED op-3 complete followed by
// the payout frames (state before presentation, the levelup-burst
// declared order).
func (rt *Runtime) HandleRewardSelect(character *enterworld.Character, payload []byte) (OpResult, error) {
	refID, err := DecodeQuestRefRequest(payload)
	if err != nil {
		return OpResult{}, err
	}
	def, ok := rt.Defs.ByRefID(refID)
	if !ok {
		return OpResult{}, fmt.Errorf("quest reward: id %d has no loaded definition", refID)
	}
	if def.KindByte != 2 {
		return OpResult{}, fmt.Errorf("quest reward: %s (id %d) is kind %d - only kind 2 opens the reward window (sub_5c26e0)", def.Codename, refID, def.KindByte)
	}

	result, err := rt.completeReward(character, def)
	if err != nil {
		return result, err
	}
	// 75C370 consumes successful B29A and triggers SND_QUEST. The
	// journal delta alone cannot acknowledge the native reward operation.
	ack := append([]byte{1}, payload...)
	result.Frames = append(result.Frames, wire.Frame{Opcode: 0xb29a, Payload: ack})
	return result, nil
}

func (rt *Runtime) completeReward(character *enterworld.Character, def *Definition) (OpResult, error) {
	return rt.completeRewardAt(character, def, nil, "")
}

func (rt *Runtime) completeRewardAt(character *enterworld.Character, def *Definition, expectedStage *uint16, npc string) (OpResult, error) {
	refID := def.RefID
	if (len(def.RewardItems) != 0 || collectsItems(def)) && rt.PlanInventory == nil {
		return OpResult{}, fmt.Errorf("quest reward: %s requires an item reward owner", def.Codename)
	}
	var refusal error
	var goldFrame *wire.Frame
	var experienceFrames []wire.Frame
	var inventoryFrames []wire.Frame
	var objectiveFrames []wire.Frame
	var advanced *enterworld.ActiveQuestRecord
	root := def
	changed := rt.deps.Update(character, "quest-reward", func() bool {
		if character == nil || character.DeletePending {
			refusal = fmt.Errorf("quest reward: character unavailable")
			return false
		}
		at := activeQuestIndex(character, refID)
		if at < 0 {
			refusal = fmt.Errorf("quest reward: %s (id %d) is not active", def.Codename, refID)
			return false
		}
		if len(root.Stages) == 0 && character.ActiveQuests[at].Stage != 0 {
			refusal = fmt.Errorf("unexpected stage on an unstaged quest")
			return false
		}
		if len(root.Stages) > 0 {
			if expectedStage == nil || character.ActiveQuests[at].Stage != *expectedStage {
				refusal = fmt.Errorf("quest stage confirmation is stale or absent")
				return false
			}
			var valid bool
			def, valid = definitionAtStage(root, *expectedStage)
			if !valid || npc == "" || npc != def.EndNpcCodename {
				refusal = fmt.Errorf("quest stage/NPC mismatch")
				return false
			}
		}
		if (len(def.RewardItems) > 0 || collectsItems(def)) && rt.PlanInventory == nil {
			refusal = fmt.Errorf("quest stage inventory owner unavailable")
			return false
		}
		if !stageObjectiveMet(character, def, character.ActiveQuests[at]) {
			refusal = fmt.Errorf("quest reward: %s (id %d) objective incomplete (%d/%d)", def.Codename, refID, recordProgress(character.ActiveQuests[at]), objectiveRequired(def))
			return false
		}
		if (len(root.Stages) == 0 || int(def.stageIndex)+1 == len(root.Stages)) && !questCompleted(character, refID) && len(character.CompletedQuestIds) >= 255 {
			refusal = fmt.Errorf("quest reward: completed quest wire capacity reached")
			return false
		}
		var inventoryRows []enterworld.InventoryRow
		if len(def.RewardItems) > 0 || collectsItems(def) {
			consume := collectionConsumption(def)
			var grants []inventory.ItemAmount
			for _, r := range def.RewardItems {
				grants = append(grants, inventory.ItemAmount{Codename: rewardItemForCharacter(character, r.ItemCodename), Count: r.Count})
			}
			var err error
			inventoryRows, inventoryFrames, err = rt.PlanInventory(character, consume, grants)
			if err != nil {
				refusal = inventoryRefusal(def, err)
				return false
			}
		}
		if def.RewardExp > 0 || def.RewardSkillExp > 0 {
			var applied bool
			experienceFrames, applied = rt.ApplyExperience(character, def.RewardExp, def.RewardSkillExp, 0)
			if !applied {
				refusal = fmt.Errorf("quest reward: %s (id %d) experience could not be applied", def.Codename, refID)
				return false
			}
		}
		if inventoryRows != nil {
			character.MissionInventory = inventoryRows
		}
		if len(root.Stages) > 0 && int(def.stageIndex)+1 < len(root.Stages) {
			nextDef, _ := definitionAtStage(root, def.stageIndex+1)
			progress := uint32(0)
			if nextDef.Objective == ObjectiveCollect {
				progress = heldCollectCount(character, nextDef)
			}
			record := BuildActiveQuestRecord(nextDef, progress)
			character.ActiveQuests[at] = record
			advanced = &record
		} else {
			next := make([]enterworld.ActiveQuestRecord, 0, len(character.ActiveQuests)-1)
			next = append(next, character.ActiveQuests[:at]...)
			next = append(next, character.ActiveQuests[at+1:]...)
			character.ActiveQuests = next
			recordCompletion(character, refID)
			completed := make([]uint32, 0, len(character.CompletedQuestIds)+1)
			completed = append(completed, character.CompletedQuestIds...)
			if !questCompleted(character, refID) {
				completed = append(completed, refID)
			}
			character.CompletedQuestIds = completed
		}
		objectiveFrames, _ = rt.applyInventoryChange(character)
		if def.RewardGold > 0 {
			balance := creditGold(character.Gold, def.RewardGold)
			character.Gold = &balance
			goldFrame = &wire.Frame{
				Opcode:  wire.OpGoldRefresh,
				Payload: wire.GoldRefresh{Balance: uint64(balance)}.Encode(),
			}
		}
		return true
	})
	if refusal != nil {
		return OpResult{}, refusal
	}
	if !changed {
		return OpResult{}, fmt.Errorf("quest reward: character is no longer authoritative")
	}

	frames := []wire.Frame{
		{Opcode: OpQuestUpdate, Payload: EncodeQuestUpdateComplete(refID)},
	}
	if advanced != nil {
		frames[0].Payload = EncodeQuestUpdateUpdate(*advanced)
	}
	if goldFrame != nil {
		frames = append(frames, *goldFrame)
	}
	frames = append(inventoryFrames, frames...)
	frames = append(frames, objectiveFrames...)
	frames = append(frames, experienceFrames...)
	return OpResult{
		Frames:    frames,
		Broadcast: wire.ProgressionBroadcastFrames(experienceFrames),
	}, nil
}

// creditGold applies a positive quest reward without allowing a corrupt or
// ceiling-valued persisted balance to wrap through int64 and become a huge
// unsigned wire balance. Negative persisted gold is healed to zero, matching
// the item-operation gold authority.
func creditGold(stored *int64, reward int64) int64 {
	balance := int64(0)
	if stored != nil && *stored > 0 {
		balance = *stored
	}
	if reward <= 0 {
		return balance
	}
	if balance > math.MaxInt64-reward {
		return math.MaxInt64
	}
	return balance + reward
}

// NotifyInventoryChanged recomputes every active collect objective from
// the character's CURRENT inventory and answers the 0x31ED op-2 updates
// for the ones whose progress moved. The action runtime calls it after
// a pickup grant and after a ground drop (the two mutations that change
// held counts today); explicit server-side progress mutations land on
// the same recompute. Quests this server's definitions do not know stay
// untouched (a seeded/foreign record is not this lane's to move).
func (rt *Runtime) NotifyInventoryChanged(character *enterworld.Character) []wire.Frame {
	if character == nil || rt.Defs.Len() == 0 {
		return nil
	}
	var frames []wire.Frame
	rt.deps.Update(character, "quest-collect", func() bool {
		var changed bool
		frames, changed = rt.applyInventoryChange(character)
		return changed
	})
	return frames
}

// InventoryUpdater returns the collect-objective updater used inside an item
// transaction. The returned function opens no authority door, allowing the
// inventory row and its derived quest progress to commit together.
func (rt *Runtime) InventoryUpdater() func(*enterworld.Character) ([]wire.Frame, bool) {
	return rt.applyInventoryChange
}

func (rt *Runtime) applyInventoryChange(character *enterworld.Character) ([]wire.Frame, bool) {
	if character == nil || character.DeletePending || rt.Defs.Len() == 0 {
		return nil, false
	}
	var frames []wire.Frame
	for index, record := range character.ActiveQuests {
		def, ok := rt.Defs.ByRefID(record.RefID)
		if ok {
			def, ok = definitionAtStage(def, record.Stage)
		}
		if !ok || !collectsItems(def) || def.TimeLimitMinutes > 0 && record.RemainingMinutes == 0 {
			continue
		}
		updated, changed := refreshMissions(character, def, record, "", 0)
		if !changed {
			continue
		}
		character.ActiveQuests[index] = updated
		frames = append(frames, wire.Frame{
			Opcode:  OpQuestUpdate,
			Payload: encodeMissionProgress(record, updated),
		})
	}
	return frames, len(frames) > 0
}
