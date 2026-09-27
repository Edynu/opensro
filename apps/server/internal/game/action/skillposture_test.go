package action

import (
	"testing"
	"time"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

/*
==================
TestSeatedSkillPressStandsInsteadOfCasting

A press from a settled seat stands the player (the 0x3122 stand push to
self and observers) and casts nothing; a press inside the stand-up
transition is dropped; at the transition's half-open deadline the same
press casts.
==================
*/
func TestSeatedSkillPressStandsInsteadOfCasting(t *testing.T) {
	rt, clock, character, target := newCombatTestRuntime(t, 100)
	payload := wire.SkillAction{
		ActionId: 2, HasTarget: true, TargetGid: target.Gid,
	}.Encode()
	worldKey := simulation.WorldKey(testDivision, character.Name)
	seed := func() simulation.WorldState { return simulation.SeedWorldState(character) }

	rt.Worlds.Update(worldKey, seed, func(world *simulation.WorldState) {
		world.Sitting = true
		world.PostureTransitionUntilMs = clock.NowMs() - 1
	})
	stand := wire.ObjectStateRefresh{
		Gid:       enterworld.ObjectIDForCharacter(character),
		StateType: wire.StateChannelMove,
		Value:     wire.MoveStateStand,
	}.Encode()
	result := rt.HandleTargetInteract(testDivision, character, payload)
	if len(result.Frames) != 1 || result.Frames[0].Opcode != wire.OpObjectStateRefresh ||
		string(result.Frames[0].Payload) != string(stand) ||
		len(result.Broadcast) != 1 || string(result.Broadcast[0].Payload) != string(stand) {
		t.Fatalf("seated press = %+v, want the stand push only", result)
	}
	if current, ok := rt.Monsters.Get(testDivision, target.Gid); !ok || current.CurrentHP != target.CurrentHP {
		t.Fatalf("seated press struck the target: %+v/%v", current, ok)
	}
	world := rt.Worlds.Snapshot(worldKey, seed)
	if world.Sitting || world.PostureTransitionUntilMs != clock.NowMs()+simulation.PostureTransitionMs {
		t.Fatalf("seated press left posture %+v", world)
	}

	clock.Advance(900 * time.Millisecond)
	if result := rt.HandleTargetInteract(testDivision, character, payload); len(result.Frames) != 0 || len(result.Broadcast) != 0 {
		t.Fatalf("press during the stand-up escaped: %+v", result)
	}
	clock.Advance(time.Duration(simulation.PostureTransitionMs-900) * time.Millisecond)
	accepted := rt.HandleTargetInteract(testDivision, character, payload)
	assertSkillDamageOpen(t, accepted.Frames, 2,
		enterworld.ObjectIDForCharacter(character), target.Gid)
}

func TestBasicAttackPostureAdmissionPrecedesPursuit(t *testing.T) {
	rt, clock, character, target := newCombatTestRuntime(t, 100)
	*character.World.Spawn.X = 900
	worldKey := simulation.WorldKey(testDivision, character.Name)
	rt.Worlds.Update(worldKey,
		func() simulation.WorldState { return simulation.SeedWorldState(character) },
		func(world *simulation.WorldState) {
			world.Sitting = false
			world.PostureTransitionUntilMs = clock.NowMs() + 900
		})

	result := rt.HandleTargetInteract(testDivision, character,
		wire.BasicAttackEngage{TargetGid: target.Gid}.Encode())
	if len(result.Frames) != 0 || len(result.Broadcast) != 0 {
		t.Fatalf("posture-blocked engage = %+v, want no movement/action", result)
	}
	if intents := rt.combatIntentSnapshot(); len(intents) != 0 {
		t.Fatalf("posture-blocked engage retained intent: %+v", intents)
	}
	world := rt.Worlds.Snapshot(worldKey,
		func() simulation.WorldState { return simulation.SeedWorldState(character) })
	if world.MoveSegment.Valid() {
		t.Fatalf("posture-blocked engage started pursuit: %+v", world.MoveSegment)
	}
}
