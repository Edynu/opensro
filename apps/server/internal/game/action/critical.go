package action

import (
	"strings"
	"sync"

	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
)

type criticalActor struct {
	division, character string
	monster             uint32
}
type criticalHistory struct {
	mu     sync.Mutex
	actors map[criticalActor]map[uint32]combat.Probability
}

// Action owns native ParamKeeper's probability history. All production attack
// paths use this door; formula helpers alone intentionally have no actor state.
// Targets do not enter the key: changing victims must not reset critical odds.
func (rt *Runtime) resolveCombat(actor criticalActor, skill enterworld.SkillRow, attacker, defender combat.Stats) (combat.Result, error) {
	out, err := rt.resolveCombatBehindWall(actor, skill, attacker, defender, nil)
	return out.Defender, err
}

// resolveCombatBehindWall splits the hit when the defender stands behind a
// Force wall (58E5F0); the one critical decision serves both records.
func (rt *Runtime) resolveCombatBehindWall(actor criticalActor, skill enterworld.SkillRow, attacker, defender combat.Stats, wall *enterworld.SkillWall) (combat.WallOutcome, error) {
	rt.criticals.mu.Lock()
	defer rt.criticals.mu.Unlock()
	actor.character = strings.ToLower(actor.character)
	key := skill.ID & 0xffffff // 58ED8C..58ED97: key is 0x43000000 | skill ID.
	previous := rt.criticals.actors[actor][key]
	critical, next := false, previous
	if skill.Attack.Flags&4 != 0 {
		rate, err := combat.EffectiveCriticalRate(attacker.CriticalRate, skill.CriticalModifier)
		if err != nil {
			return combat.WallOutcome{}, err
		}
		critical, next, err = combat.CriticalOutcome(float64(rate), previous, rt.CombatRoll)
		if err != nil {
			return combat.WallOutcome{}, err
		}
	}
	var out combat.WallOutcome
	var err error
	if wall != nil {
		out, err = combat.ResolveAgainstWall(attacker, defender, skill.Attack, *wall, rt.CombatRoll, actor.monster == 0, critical)
	} else {
		out.Defender, err = combat.ResolveOutcome(attacker, defender, skill.Attack, rt.CombatRoll, actor.monster == 0, critical)
	}
	if err != nil {
		return combat.WallOutcome{}, err
	}
	// 58F0C1..58F0F3: after the wall's share, every impact of an attack
	// skill rolls the target's block chance on the attacker's history
	// (key 0x42000000 | skill); a block drops the defender's damage.
	if skill.Attack.Present {
		chance := combat.BlockChance(attacker, defender, skill.Attack.Flags, skill.Ck)
		blockKey := 0x42000000 | skill.ID&0xffffff
		blocked, blockNext, err := combat.CriticalOutcome(float64(chance), rt.criticals.actors[actor][blockKey], rt.CombatRoll)
		if err != nil {
			return combat.WallOutcome{}, err
		}
		if blockNext.Initialized {
			if rt.criticals.actors == nil {
				rt.criticals.actors = make(map[criticalActor]map[uint32]combat.Probability)
			}
			if rt.criticals.actors[actor] == nil {
				rt.criticals.actors[actor] = make(map[uint32]combat.Probability)
			}
			rt.criticals.actors[actor][blockKey] = blockNext
		}
		if blocked {
			out.Defender = combat.Result{ResultFlags: out.Defender.ResultFlags, Blocked: true}
		}
	}
	if next.Initialized {
		if rt.criticals.actors == nil {
			rt.criticals.actors = make(map[criticalActor]map[uint32]combat.Probability)
		}
		if rt.criticals.actors[actor] == nil {
			rt.criticals.actors[actor] = make(map[uint32]combat.Probability)
		}
		rt.criticals.actors[actor][key] = next
	}
	return out, nil
}

func (rt *Runtime) forgetCriticalCharacter(division, name string) {
	rt.criticals.mu.Lock()
	defer rt.criticals.mu.Unlock()
	delete(rt.criticals.actors, criticalActor{division: division, character: strings.ToLower(name)})
}

func (rt *Runtime) retireMonsterCriticals() {
	rt.criticals.mu.Lock()
	defer rt.criticals.mu.Unlock()
	for key := range rt.criticals.actors {
		if key.monster == 0 {
			continue
		}
		if rt.Monsters == nil {
			delete(rt.criticals.actors, key)
			continue
		}
		if instance, ok := rt.Monsters.Get(key.division, key.monster); !ok || instance.CurrentHP == 0 {
			delete(rt.criticals.actors, key)
		}
	}
}

func (rt *Runtime) effectOutcome(actor criticalActor, key, chance uint32) (bool, error) {
	rt.criticals.mu.Lock()
	defer rt.criticals.mu.Unlock()
	actor.character = strings.ToLower(actor.character)
	proc, next, err := combat.CriticalOutcome(float64(chance), rt.criticals.actors[actor][key], rt.CombatRoll)
	if err == nil && next.Initialized {
		if rt.criticals.actors == nil {
			rt.criticals.actors = make(map[criticalActor]map[uint32]combat.Probability)
		}
		if rt.criticals.actors[actor] == nil {
			rt.criticals.actors[actor] = make(map[uint32]combat.Probability)
		}
		rt.criticals.actors[actor][key] = next
	}
	return proc, err
}
