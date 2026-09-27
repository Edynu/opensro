/*
===========================================================================

naturalrecovery.go - natural HP / MP recovery ticks (4A6DF0 / 4A9D00 / 4E2990)

===========================================================================
*/

package action

import (
	"sort"
	"strings"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

// Later GameServer: 4A6DF0 registers a four-second callback, 4A9D00
// selects 0.8/8 percent for standing/sitting, and 4E2990 applies it.
const naturalRecoveryIntervalMs int64 = 4000

type recoveryKey struct{ division, name string }
type recoverySession struct {
	session     uint64
	character   *enterworld.Character
	nextMs      int64
	questNextMs int64
}

// BindRecoverySession admits only authenticated world residents. A duplicate
// bind preserves the timer; replacement and disconnect cannot inherit it.
func (rt *Runtime) BindRecoverySession(division string, c *enterworld.Character, session uint64) {
	if c == nil || session == 0 {
		return
	}
	unlock := rt.lockDivision(division)
	defer unlock()
	key := recoveryKey{division, strings.ToLower(c.Name)}
	rt.recoveryMu.Lock()
	defer rt.recoveryMu.Unlock()
	if old := rt.recoverySessions[key]; old != nil && old.session == session && old.character == c {
		return
	}
	if rt.recoverySessions == nil {
		rt.recoverySessions = make(map[recoveryKey]*recoverySession)
	}
	now := rt.Now().UnixMilli()
	rt.recoverySessions[key] = &recoverySession{session: session, character: c, nextMs: now + naturalRecoveryIntervalMs, questNextMs: now + 60000}
}

// Division lock precedes the collection lock throughout this owner.
func (rt *Runtime) forgetRecoverySession(division, name string) {
	rt.recoveryMu.Lock()
	defer rt.recoveryMu.Unlock()
	delete(rt.recoverySessions, recoveryKey{division, strings.ToLower(name)})
}

func naturalRecoveryAmount(maximum int64, sitting bool) int64 {
	if maximum <= 0 {
		return 0
	}
	rate := float32(0.8)
	if sitting {
		rate = 8
	}
	// Native converts the unsigned maximum to float32 before x87 multiply
	// and truncation. Do not replace this with rounded integer percentages.
	cap := float64(float32(maximum))
	return min(max(int64(cap*float64(rate)/100), 1), int64(cap*0.5))
}

func (rt *Runtime) advanceNaturalRecovery(nowMs int64) []simulation.DivisionFrames {
	rt.recoveryMu.Lock()
	var keys []recoveryKey
	for key, state := range rt.recoverySessions {
		if nowMs >= state.nextMs || rt.AdvanceQuestMinute != nil && nowMs >= state.questNextMs {
			keys = append(keys, key)
		}
	}
	rt.recoveryMu.Unlock()
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].division != keys[j].division {
			return keys[i].division < keys[j].division
		}
		return keys[i].name < keys[j].name
	})
	var out []simulation.DivisionFrames
	for _, key := range keys {
		unlock := rt.lockDivision(key.division)
		out = append(out, rt.advanceResidentQuestMinute(key, nowMs)...)
		frames := rt.recoverResident(key, nowMs)
		out = append(out, frames...)
		unlock()
	}
	return out
}

/*
==================
advanceResidentQuestMinute

The same admitted actor owns recovery and quest pulses. Native 4A7050
registers 4AC700 at 60 seconds -> 4EB7C0 -> 605400 -> 52B030 (event 14).
Preserve one callback per update and residual phase (4AB700).
==================
*/
func (rt *Runtime) advanceResidentQuestMinute(key recoveryKey, nowMs int64) []simulation.DivisionFrames {
	if rt.AdvanceQuestMinute == nil {
		return nil
	}
	rt.recoveryMu.Lock()
	state := rt.recoverySessions[key]
	if state == nil || nowMs < state.questNextMs {
		rt.recoveryMu.Unlock()
		return nil
	}
	state.questNextMs += 60000
	c := state.character
	rt.recoveryMu.Unlock()
	frames := rt.AdvanceQuestMinute(c)
	if len(frames) == 0 {
		return nil
	}
	out := simulation.DivisionFrames{DivisionID: key.division, OnlyCharacterID: c.ID}
	for _, frame := range frames {
		out.Frames = append(out.Frames, simulation.Frame{Opcode: frame.Opcode, Payload: frame.Payload, Current: frame.Current, Scope: frame.Scope})
	}
	return []simulation.DivisionFrames{out}
}

func (rt *Runtime) recoverResident(key recoveryKey, nowMs int64) []simulation.DivisionFrames {
	rt.recoveryMu.Lock()
	state := rt.recoverySessions[key]
	if state == nil || nowMs < state.nextMs {
		rt.recoveryMu.Unlock()
		return nil
	}
	// Native 4AB729 subtracts one period and invokes once per owner update.
	// Keep the residual phase, including pulses skipped while moving/dead.
	state.nextMs += naturalRecoveryIntervalMs
	rt.recoveryMu.Unlock()
	c := state.character
	if rt.hasOpenSkillCast(key.division, c.Name) {
		return nil
	}
	var frames []simulation.DivisionFrames
	committed := rt.deps.Update(c, "natural-recovery", func() bool {
		if c.DeletePending || !enterworld.CharacterAlive(c) {
			return false
		}
		world := rt.Worlds.Snapshot(simulation.WorldKey(key.division, c.Name), func() simulation.WorldState { return simulation.SeedWorldState(c) })
		if nowMs < world.PostureTransitionUntilMs || (world.MoveSegment.Valid() && nowMs < world.MoveSegment.ArrivesAtMs) {
			return false
		}
		maxHP, maxMP, hp, mp := rt.playerKeeperVitals(key.division, c)
		nextHP, nextMP := hp, mp
		if hp < maxHP {
			nextHP = min(maxHP, hp+naturalRecoveryAmount(maxHP, world.Sitting))
		}
		if mp < maxMP {
			nextMP = min(maxMP, mp+naturalRecoveryAmount(maxMP, world.Sitting))
		}
		if nextHP == hp && nextMP == mp {
			return false
		}
		c.CurrentHP, c.CurrentMP = &nextHP, &nextMP
		frames = []simulation.DivisionFrames{{DivisionID: key.division, OnlyCharacterID: c.ID, Frames: []simulation.Frame{{Opcode: simulation.OpVitalsUpdate, Payload: simulation.VitalsRefreshWithSourcePayload(enterworld.ObjectIDForCharacter(c), simulation.VitalsSourceNaturalRecovery, simulation.Vitals{CurrentHP: uint32(nextHP), CurrentMP: uint32(nextMP)})}}}}
		return true
	})
	if !committed {
		return nil
	}
	return frames
}
