/*
===========================================================================

cosabnormal.go - abnormal-state blocks of pets (COS)

===========================================================================
*/

package action

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"

	"opensro.online/server/internal/game/abnormal"
	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/simulation"
)

// cosAbnormalEntry is one pet's CGObjChar block. 49D240 cures the COS at
// +0x34C, which is not the owner's player block.
type cosAbnormalEntry struct {
	division string
	name     string
	gid      uint32
	block    *abnormal.Block
}

type cosAbnormalStore struct {
	mu     sync.Mutex
	blocks map[string]cosAbnormalEntry
}

func cosAbnormalKey(division, name string, gid uint32) string {
	return strings.ToLower(division) + "\x00" + strings.ToLower(name) + "\x00" + fmt.Sprint(gid)
}

func (rt *Runtime) cosAbnormal(division, name string, gid uint32) *abnormal.Block {
	rt.cosAbnormals.mu.Lock()
	defer rt.cosAbnormals.mu.Unlock()
	return rt.cosAbnormals.blocks[cosAbnormalKey(division, name, gid)].block
}

func (rt *Runtime) storeCosAbnormal(division, name string, gid uint32, block *abnormal.Block) {
	rt.cosAbnormals.mu.Lock()
	defer rt.cosAbnormals.mu.Unlock()
	key := cosAbnormalKey(division, name, gid)
	if block == nil || (block.Mask == 0 && !block.Active()) {
		delete(rt.cosAbnormals.blocks, key)
		return
	}
	if rt.cosAbnormals.blocks == nil {
		rt.cosAbnormals.blocks = map[string]cosAbnormalEntry{}
	}
	copied := *block
	rt.cosAbnormals.blocks[key] = cosAbnormalEntry{division: division, name: name, gid: gid, block: &copied}
}

func (rt *Runtime) cosAbnormalCandidates() []cosAbnormalEntry {
	rt.cosAbnormals.mu.Lock()
	defer rt.cosAbnormals.mu.Unlock()
	out := make([]cosAbnormalEntry, 0, len(rt.cosAbnormals.blocks))
	for _, entry := range rt.cosAbnormals.blocks {
		out = append(out, entry)
	}
	return out
}

type cosAbnormalOwner struct {
	rt       *Runtime
	division string
	c        *enterworld.Character
	block    *abnormal.Block
	now      int64
	changed  bool
	fatal    bool
}

func (rt *Runtime) newCosAbnormalOwner(division string, c *enterworld.Character, now int64) *cosAbnormalOwner {
	o := &cosAbnormalOwner{rt: rt, division: division, c: c, now: now, block: &abnormal.Block{}}
	if c == nil || c.ActiveCOS == nil {
		return o
	}
	if current := rt.cosAbnormal(division, c.Name, c.ActiveCOS.GID); current != nil {
		copied := *current
		o.block = &copied
	}
	return o
}

func (o *cosAbnormalOwner) commit() {
	if o.c == nil || o.c.ActiveCOS == nil {
		return
	}
	if o.fatal || o.c.ActiveCOS.CurrentHP == 0 {
		o.changed = o.block.ClearAll(o) || o.changed
		o.fatal = true
	}
	o.rt.storeCosAbnormal(o.division, o.c.Name, o.c.ActiveCOS.GID, o.block)
}

func (o *cosAbnormalOwner) Alive() bool {
	return o.c != nil && o.c.ActiveCOS != nil && o.c.ActiveCOS.CurrentHP > 0
}
func (o *cosAbnormalOwner) IsPlayer() bool  { return false }
func (o *cosAbnormalOwner) IsMonster() bool { return false }
func (o *cosAbnormalOwner) CurrentHP() uint32 {
	if !o.Alive() {
		return 0
	}
	return o.c.ActiveCOS.CurrentHP
}
func (o *cosAbnormalOwner) MaxHP() uint32 {
	if o.c == nil || o.c.ActiveCOS == nil {
		return 0
	}
	return o.c.ActiveCOS.CurrentHP
}
func (o *cosAbnormalOwner) MaxMP() uint32 {
	if o.c == nil || o.c.ActiveCOS == nil {
		return 0
	}
	return o.c.ActiveCOS.CurrentMP
}
func (o *cosAbnormalOwner) Param(uint16) float32 { return 0 }
func (o *cosAbnormalOwner) SourceExists(gid uint32) bool {
	return o.rt.abnormalSourceExists(o.division, gid)
}
func (o *cosAbnormalOwner) SourceDead(gid uint32) bool {
	return o.rt.abnormalSourceDead(o.division, gid)
}
func (o *cosAbnormalOwner) Roll(key uint32, chance int32) bool {
	if chance <= 0 || o.c == nil {
		return false
	}
	proc, err := o.rt.effectOutcome(criticalActor{division: o.division, character: o.c.Name}, key, uint32(chance))
	return err == nil && proc
}
func (o *cosAbnormalOwner) Now() int64                                       { return o.now }
func (o *cosAbnormalOwner) ParamsChanged(bool)                               {}
func (o *cosAbnormalOwner) SetMotion(uint8, uint8, float32)                  {}
func (o *cosAbnormalOwner) CancelActions(bool)                               {}
func (o *cosAbnormalOwner) StopMove()                                        {}
func (o *cosAbnormalOwner) AIEvent(uint8, uint8, uint32)                     {}
func (o *cosAbnormalOwner) Hit(uint32, bool, uint32, uint8, abnormal.Status) {}
func (o *cosAbnormalOwner) ConsumeResources(int32, int32, uint8)             {}
func (o *cosAbnormalOwner) Detonate(abnormal.Slot)                           {}

// cosAbnormalPublication is the player 0x36C7 / 33A6 pair with the pet gid.
func (rt *Runtime) cosAbnormalPublication(gid uint32, o *cosAbnormalOwner) []wire.Frame {
	if o == nil || o.c == nil || !o.changed {
		return nil
	}
	// 4A5C60 sends the state snapshot (server 30D2, v1.150 0x36C7) only when
	// vfunc +1C reports a player; the client applies 0x36C7 to the local
	// player (77C110). A COS publishes its mask through the shared vitals
	// channel (dirty bit 0x100 -> 33A6) alone.
	block := rt.cosAbnormal(o.division, o.c.Name, gid)
	return []wire.Frame{{Opcode: simulation.OpVitalsUpdate, Payload: abnormalVitalsPayload(gid, block)}}
}

func (rt *Runtime) characterByCosGID(division string, gid uint32) *enterworld.Character {
	if gid == 0 || rt.deps == nil {
		return nil
	}
	for _, character := range rt.deps.CharactersForDivision(division) {
		if character != nil && character.ActiveCOS != nil && character.ActiveCOS.Summoned && character.ActiveCOS.GID == gid {
			return character
		}
	}
	return nil
}

func (rt *Runtime) advanceCosAbnormals(now int64) []simulation.DivisionFrames {
	var out []simulation.DivisionFrames
	for _, entry := range rt.cosAbnormalCandidates() {
		out = append(out, rt.advanceOneCosAbnormal(entry, now)...)
	}
	return out
}

func (rt *Runtime) advanceOneCosAbnormal(entry cosAbnormalEntry, now int64) []simulation.DivisionFrames {
	unlock := rt.lockDivision(entry.division)
	defer unlock()
	c := rt.findCharacter(entry.division, entry.name)
	if c == nil || c.ActiveCOS == nil || c.ActiveCOS.GID != entry.gid {
		rt.storeCosAbnormal(entry.division, entry.name, entry.gid, nil)
		return nil
	}
	var owner *cosAbnormalOwner
	committed := rt.deps.Update(c, "cos-abnormal", func() bool {
		owner = rt.newCosAbnormalOwner(entry.division, c, now)
		if c.ActiveCOS.CurrentHP == 0 {
			owner.changed = owner.block.ClearAll(owner)
			owner.fatal = true
		} else if result := owner.block.Update(owner, now); result.Changed {
			owner.changed = true
		}
		owner.commit()
		return owner.changed
	})
	if !committed || owner == nil {
		return nil
	}
	frames := rt.cosAbnormalPublication(entry.gid, owner)
	return playerAbnormalDivisionFrames(entry.division, c.ID, playerAbnormalFrames{actor: frames, public: frames})
}

/*
==================
monsterHitSummonedCOS

monsterHitSummonedCOS applies a monster skill impact to the substituted
COS (529929 -> PC+0x1CD8). The pet has no separate pose in this port, so
range uses the owner's live position: the client keeps an unmounted pet
on the owner. Status rolls use 590680 with the pet gid and a keeper that
has the COS level only; v1.150 characterdata does not ship pet resist params.
==================
*/
func (rt *Runtime) monsterHitSummonedCOS(divisionID string, instance monster.Instance, owner *enterworld.Character, skillID uint32, nowMs int64) (result simulation.MonsterAttackResult) {
	pet := owner.ActiveCOS
	if pet == nil || !pet.Summoned || pet.CurrentHP == 0 || skillID == 0 {
		return result
	}
	skill, ok := rt.deps.SkillData().SkillByID(skillID)
	actionLifecycleMs, actionLifecyclePinned := skill.ActionLifecycleMs()
	attackShape := ok && skill.CombatPinned && skill.Attack.Present && skill.TargetRequired
	timed := actionLifecyclePinned && actionLifecycleMs != 0 && skill.ActionCastingTimeMs == 0
	ranged := skill.ActionRangePinned && skill.ActionRange > 0
	if !attackShape || !timed || !ranged {
		return result
	}
	snapshot := rt.characterSnapshot(divisionID, owner)
	if snapshot == nil || snapshot.ActiveCOS == nil || snapshot.ActiveCOS.GID != pet.GID {
		return result
	}
	mover, exists := rt.Monsters.Mover(divisionID, instance.Gid)
	if !exists {
		return result
	}
	monsterPose := mover.LivePoseAt(nowMs, nil)
	ownerPose := rt.liveSpawn(simulation.WorldKey(divisionID, snapshot.Name), snapshot, nowMs)
	spacing, spacingOK := rt.monsterToPlayerCombatSpacing(instance, snapshot, simulation.ActionReach(skill.ActionRange))
	if !spacingOK || !spacing.Contains(simulation.Spawn{RegionID: monsterPose.RegionID, X: monsterPose.X, Y: monsterPose.Y, Z: monsterPose.Z}, ownerPose) {
		result.Refusal = simulation.MonsterAttackApproachRequired
		return result
	}
	attacker, err := combat.MonsterInstanceStats(instance)
	if err != nil {
		return result
	}
	// The COS is not a CGObjPC keeper. Damage uses the owner's stats so a
	// zero-defense pet does not fail the formula; the status block is the pet's.
	defender, _, err := rt.playerCombatStats(divisionID, owner)
	if err != nil {
		return result
	}
	defender.Level = pet.Level
	var records []abnormal.Record
	var damage uint32
	blocks := 0
	for range skill.Attack.ImpactCount {
		formula, resolveErr := rt.resolveCombat(criticalActor{division: divisionID, monster: instance.Gid}, skill, attacker, defender)
		if resolveErr != nil || formula.Damage == 0 && !formula.Blocked {
			return result
		}
		if formula.Blocked {
			blocks++
			continue // 5905FB: no damage and no status roll
		}
		rolled, rollErr := rt.rollMonsterOnCOS(divisionID, instance, &skill.Abnormal, pet.GID, defender, formula.ResultFlags&8 != 0)
		if rollErr != nil {
			return result
		}
		records = append(records, rolled...)
		damage += formula.Damage
	}
	var ownerBlock *cosAbnormalOwner
	var fatal bool
	var battleFrames []wire.Frame
	committed := rt.deps.Update(owner, "monster-cos-hit", func() bool {
		live := owner.ActiveCOS
		if live == nil || live.GID != pet.GID || live.CurrentHP == 0 {
			return false
		}
		// CGObjCOS_ProcessNormalHit (52A1E0): the owner (COS+0x1CD8) enters
		// battle (4E1DF0) before the pet takes the hit, fatal or not.
		if enterworld.CharacterAlive(owner) {
			battleFrames = rt.enterBattleState(divisionID, owner, nowMs)
		}
		if damage >= live.CurrentHP {
			live.CurrentHP = 0
			fatal = true
		} else {
			live.CurrentHP -= damage
		}
		ownerBlock = rt.newCosAbnormalOwner(divisionID, owner, nowMs)
		if fatal {
			ownerBlock.changed = ownerBlock.block.ClearAll(ownerBlock)
			ownerBlock.fatal = true
		} else {
			if ownerBlock.block.Mask != 0 {
				ownerBlock.changed = ownerBlock.block.BreakOnHit(ownerBlock) || ownerBlock.changed
			}
			for _, record := range records {
				if ownerBlock.block.Apply(ownerBlock, record, nowMs) {
					ownerBlock.changed = true
				}
			}
		}
		ownerBlock.commit()
		return true
	})
	if !committed {
		return result
	}
	token := atomic.AddUint32(&rt.castTokenCounter, 1)
	wireResult := wire.NewStationarySkillCastSingleTargetResult(
		wire.SkillCastSuccess{SkillId: skillID, CasterGid: instance.Gid, InstanceToken: token},
		pet.GID,
		[]wire.SkillCastTargetImpact{{Damage: damage, Fatal: fatal, Blocked: blocks == int(skill.Attack.ImpactCount)}},
	)
	frame := wire.SkillCastSingleTargetResultFrame(wireResult)
	result.Frames = []simulation.Frame{{Opcode: frame.Opcode, Payload: frame.Payload, Current: frame.Current, Scope: frame.Scope}}
	result.Frames = append(result.Frames, simulation.Frame{
		Opcode:  simulation.OpVitalsUpdate,
		Payload: simulation.HPRefreshPayload(pet.GID, 0, owner.ActiveCOS.CurrentHP),
	})
	for _, published := range rt.cosAbnormalPublication(pet.GID, ownerBlock) {
		result.Frames = append(result.Frames, simulation.Frame{Opcode: published.Opcode, Payload: published.Payload})
	}
	for _, f := range battleFrames {
		result.Frames = append(result.Frames, simulation.Frame{Opcode: f.Opcode, Payload: f.Payload})
	}
	result.Accepted = true
	result.TargetAlive = !fatal
	return result
}

func (rt *Runtime) rollMonsterOnCOS(division string, instance monster.Instance, params *abnormal.SkillParams, petGID uint32, defender combat.Stats, blocked bool) ([]abnormal.Record, error) {
	if params == nil || !params.Present() {
		return nil, nil
	}
	in := abnormal.RollInput{
		Params:      params,
		Blocked:     blocked,
		TargetLevel: defender.Level,
		CasterLevel: instance.Ref.Level,
		SourceGID:   instance.Gid,
		TargetGID:   petGID,
	}
	random := &abnormalRandom{rt: rt, actor: criticalActor{division: division, monster: instance.Gid}}
	return abnormal.Roll(in, random), random.err
}
