/*
===========================================================================

linkedblessing_test.go - the Cleric's Force and Mental Blessings

===========================================================================
*/

package action

import (
	"testing"
	"time"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

const (
	forceBlessingA1  = 10380 // SKILL_EU_CLERIC_BLESSA_STR_A_01: lnks 5 1500 4 1, stri 4 50, getv HLFS
	mentalBlessingA1 = 10398 // SKILL_EU_CLERIC_BLESSA_INT_A_01: lnks 6 1500 4 1, inti 9 50, getv HLMI
)

func linkedHalves(rt *Runtime, name string, id uint32) (phases []uint8) {
	for _, e := range rt.effects.Snapshot(testDivision, name) {
		if e.SkillID == id && e.LinkToken != 0 && !e.StopRequested {
			phases = append(phases, e.Phase)
		}
	}
	return phases
}

/*
==================
TestForceBlessingLinksCasterAndSubject

The caster keeps the source half (mode 1, private B5ED naming the subject)
and the ally the recipient half (mode 2, public B419) carrying stri: 4
plus the caster's HLFS, capped at 50 % of the ally's current strength.
The caster itself is not a subject, a second cast on the same ally is
300c, and leaving the 1500 link range retires both halves and the bonus.
==================
*/
func TestForceBlessingLinksCasterAndSubject(t *testing.T) {
	for _, tc := range []struct {
		name  string
		hlfs  uint32
		bonus float32
	}{{"authored", 0, 4}, {"capped", 40, 0}} {
		t.Run(tc.name, func(t *testing.T) {
			rt, clock, c := concealmentFixture(t, forceBlessingA1)
			if tc.hlfs != 0 {
				var charity enterworld.SkillRow
				charity.ID, charity.Group, charity.Level = 90003, 90003, 1
				charity.PassiveParameters.Pinned = true
				charity.PassiveParameters.Mask = enterworld.SkillParameterMask(1) << enterworld.ParameterBlessStrength
				charity.PassiveParameters.Values[enterworld.ParameterBlessStrength] = tc.hlfs
				rt.deps.SkillData().(staticSkillSource)[charity.ID] = charity
				c.Skills = append(c.Skills, charity.ID)
			}
			ally := nearbyCharacter(rt, c, 21, "ally", 1)
			before, _, err := rt.playerCombatStats(testDivision, ally)
			if err != nil {
				t.Fatal(err)
			}
			want := tc.bonus
			if tc.hlfs != 0 {
				want = float32(int32(before.Strength)) * 0.5 // 4 + 40 exceeds the cap
			}

			if r := castSelf(rt, c, forceBlessingA1); len(linkedHalves(rt, c.Name, forceBlessingA1)) != 0 || r.DiagnosticRefusal == "" && (len(r.Frames) == 0 || r.Frames[0].Payload[0] == 1) {
				t.Fatalf("the caster blessed itself: %+v", r)
			}
			cast := wire.SkillAction{ActionId: forceBlessingA1, HasTarget: true, TargetGid: enterworld.ObjectIDForCharacter(ally)}.Encode()
			r := rt.HandleTargetInteract(testDivision, c, cast)
			if r.DiagnosticRefusal != "" {
				t.Fatalf("cast refused: %+v", r)
			}
			if got := linkedHalves(rt, c.Name, forceBlessingA1); len(got) != 1 || got[0] != 1 {
				t.Fatalf("caster halves %v, want the source", got)
			}
			if got := linkedHalves(rt, ally.Name, forceBlessingA1); len(got) != 1 || got[0] != 2 {
				t.Fatalf("ally halves %v, want the recipient", got)
			}
			if _, ok := findFrame(r.Frames, wire.OpSourceEffect); !ok {
				t.Fatal("no B5ED for the caster")
			}
			if _, ok := findFrame(r.Broadcast, wire.OpSourceEffect); ok {
				t.Fatal("B5ED broadcast to peers")
			}
			if _, ok := findFrame(r.Broadcast, wire.OpAttachedEffect); !ok {
				t.Fatal("no public B419 for the recipient")
			}
			blessed, _, _ := rt.playerCombatStats(testDivision, ally)
			if float32(blessed.Strength-before.Strength) != want {
				t.Fatalf("ally strength %v -> %v, want +%v", before.Strength, blessed.Strength, want)
			}
			if caster, _, _ := rt.playerCombatStats(testDivision, c); caster.Strength != before.Strength {
				t.Fatalf("the source half raised the caster: %v", caster.Strength)
			}

			clock.Advance(2 * time.Second)
			rt.drainSkillFinalizes(clock.NowMs())
			if again := rt.HandleTargetInteract(testDivision, c, cast); again.DiagnosticRefusal != "" || len(again.Frames) != 1 || again.Frames[0].Payload[0] == 1 {
				t.Fatalf("second blessing on the same ally: %+v", again)
			}

			key := simulation.WorldKey(testDivision, ally.Name)
			rt.Worlds.Update(key, func() simulation.WorldState { return simulation.SeedWorldState(ally) }, func(w *simulation.WorldState) { w.Spawn.X += 1600 })
			rt.advanceLinkedEffects(clock.NowMs())
			rt.drainStoppedCharacterEffects()
			if len(linkedHalves(rt, c.Name, forceBlessingA1))+len(linkedHalves(rt, ally.Name, forceBlessingA1)) != 0 {
				t.Fatal("the link outlived its range")
			}
			if after, _, _ := rt.playerCombatStats(testDivision, ally); after.Strength != before.Strength {
				t.Fatalf("strength %v after the link broke, want %v", after.Strength, before.Strength)
			}
		})
	}
}

/*
==================
TestMentalBlessingRaisesIntellect

inti writes parameter 2; one caster may hold a Force and a Mental Blessing
on the same ally, since their link groups (5, 6) differ.
==================
*/
func TestMentalBlessingRaisesIntellect(t *testing.T) {
	rt, clock, c := concealmentFixture(t, forceBlessingA1, mentalBlessingA1)
	ally := nearbyCharacter(rt, c, 21, "ally", 1)
	before, _, _ := rt.playerCombatStats(testDivision, ally)
	for _, id := range []uint32{forceBlessingA1, mentalBlessingA1} {
		r := rt.HandleTargetInteract(testDivision, c, wire.SkillAction{ActionId: id, HasTarget: true, TargetGid: enterworld.ObjectIDForCharacter(ally)}.Encode())
		if r.DiagnosticRefusal != "" || len(linkedHalves(rt, ally.Name, id)) != 1 {
			t.Fatalf("blessing %d: %+v", id, r)
		}
		clock.Advance(2 * time.Second)
		rt.drainSkillFinalizes(clock.NowMs())
	}
	after, _, _ := rt.playerCombatStats(testDivision, ally)
	wantInt := min(float32(9), float32(int32(before.Intellect))*0.5)
	if float32(after.Intellect-before.Intellect) != wantInt || after.Strength-before.Strength != 4 {
		t.Fatalf("int %v -> %v, str %v -> %v", before.Intellect, after.Intellect, before.Strength, after.Strength)
	}
}
