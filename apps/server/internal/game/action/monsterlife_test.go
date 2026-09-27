/*
===========================================================================

monsterlife_test.go - tests for monsterlife.go

===========================================================================
*/

package action

import (
	"bytes"
	"opensro.online/server/internal/game/abnormal"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func assertMonsterLifeDeath(t *testing.T, frames []wire.Frame, gid uint32, want int) {
	t.Helper()
	found := 0
	for index, f := range frames {
		if f.Opcode != wire.OpObjectStateRefresh {
			continue
		}
		value, err := wire.DecodeObjectStateRefresh(f.Payload)
		if err != nil {
			t.Fatal(err)
		}
		if value.Gid != gid || value.StateType != wire.StateChannelLife {
			continue
		}
		found++
		if value.Value != wire.LifeStateDead || !bytes.Equal(f.Payload, wire.NewWriter(6).U32(gid).U8(0).U8(2).Payload()) {
			t.Fatal("wrong LIFE death bytes", f)
		}
		if index == 0 {
			t.Fatal("LIFE must follow the existing fatal result/HP publication")
		}
	}
	if found != want {
		t.Fatalf("LIFE-dead count %d want %d in %+v", found, want, frames)
	}
}
func TestMonsterLifeDirectDamagePublishesToActorAndPeersOnce(t *testing.T) {
	for _, hp := range []uint32{1, 100000} {
		rt, clock, c, target := newCombatTestRuntime(t, hp)
		result := rt.HandleTargetInteract(testDivision, c, wire.SkillAction{ActionId: 2, HasTarget: true, TargetGid: target.Gid}.Encode())
		want := 0
		if hp == 1 {
			want = 1
		}
		assertMonsterLifeDeath(t, result.Frames, target.Gid, want)
		assertMonsterLifeDeath(t, result.Broadcast, target.Gid, want)
		for _, batch := range rt.TickHook()(clock.NowMs()) {
			for _, f := range batch.Frames {
				if f.Opcode == wire.OpObjectStateRefresh && bytes.Equal(f.Payload, wire.NewWriter(6).U32(target.Gid).U8(0).U8(2).Payload()) {
					t.Fatal("tick repeated direct death")
				}
			}
		}
	}
}
func TestMonsterLifePeriodicDamageIncludesUncreditedDeaths(t *testing.T) {
	for _, kind := range []string{"burn", "bleeding"} {
		for _, hp := range []uint32{1, 100000} {
			t.Run(kind+map[uint32]string{1: "-fatal", 100000: "-nonfatal"}[hp], func(t *testing.T) {
				rt, clock, c, target := newCombatTestRuntime(t, hp)
				now := clock.NowMs()
				advance := rt.advanceMonsterAbnormals
				record := abnormal.Record{Status: abnormal.Burn, Level: 100, DurationMs: 100 * 750, Rate24: 8, Scale20: 1}
				if kind == "bleeding" {
					record = abnormal.Record{Status: abnormal.Bleeding, Grade: 1, DurationMs: 10000, PeriodMs: 2000, Param38: 10}
				}
				seedDepartedAbnormal(t, rt, c, target.Gid, record)
				public := []wire.Frame{}
				for _, batch := range advance(now) {
					if batch.OnlyCharacterID != 0 {
						t.Fatal("uncredited victim death must be public")
					}
					for _, f := range batch.Frames {
						public = append(public, wire.Frame{Opcode: f.Opcode, Payload: f.Payload})
					}
				}
				want := 0
				if hp == 1 {
					want = 1
				}
				assertMonsterLifeDeath(t, public, target.Gid, want)
				if hp == 1 && len(advance(now+1)) != 0 {
					t.Fatal("periodic death repeated")
				}
			})
		}
	}
}
