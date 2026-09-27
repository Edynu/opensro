package action

import (
	"encoding/binary"
	"opensro.online/server/internal/game/combat"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestCriticalProductionSwordRowsCommitDamageAndWireFlags(t *testing.T) {
	rt, _, c, target := newCombatTestRuntime(t, 10000)
	rt.CombatRoll = func() (uint32, error) { return 0, nil }
	result := rt.HandleTargetInteract(testDivision, c, wire.BasicAttackEngage{TargetGid: target.Gid}.Encode())
	var payload []byte
	for _, frame := range result.Frames {
		if frame.Opcode == wire.OpSkillCastResult {
			payload = frame.Payload
		}
	}
	if len(payload) != 43 {
		t.Fatalf("expected real two-impact sword result: %x (%s)", payload, result.DiagnosticRefusal)
	}
	first, second := binary.LittleEndian.Uint32(payload[26:]), binary.LittleEndian.Uint32(payload[35:])
	if uint8(first) != 2 || uint8(second) != 1 {
		t.Fatalf("critical then suppressed repeat: %x", payload)
	}
	if first>>8 < 2*(second>>8) {
		t.Fatalf("physical critical damage not doubled before truncation: %d / %d", first>>8, second>>8)
	}
	after, _ := rt.Monsters.Get(testDivision, target.Gid)
	if after.CurrentHP != target.CurrentHP-(first>>8)-(second>>8) {
		t.Fatal("packet damage differs from HP authority")
	}
	key := criticalActor{division: testDivision, character: c.Name}
	if !rt.criticals.actors[key][2].Initialized {
		t.Fatal("production cast lost probability history")
	}
	rt.ForgetCharacter(testDivision, c.Name)
	if _, ok := rt.criticals.actors[key]; ok {
		t.Fatal("actor history survived disconnect")
	}
}

func TestCriticalHistorySeparatesActorsSkillsAndRetiresMonsters(t *testing.T) {
	rt, _, c, target := newCombatTestRuntime(t, 10000)
	rt.CombatRoll = func() (uint32, error) { return 0, nil }
	a := combat.Stats{Level: 1, MaxLevel: 1, Strength: 32, PhysicalAttackMin: 100, PhysicalAttackMax: 100, CriticalRate: 3}
	d := combat.Stats{Level: 1}
	skill := enterworld.SkillRow{ID: 2, Attack: enterworld.SkillAttack{Present: true, Flags: 4, Percent: 100}}
	player := criticalActor{division: testDivision, character: c.Name}
	monster := criticalActor{division: testDivision, monster: target.Gid}
	for i, actor := range []criticalActor{player, player, monster} {
		r, err := rt.resolveCombat(actor, skill, a, d)
		want := uint8(2)
		if i == 1 {
			want = 1
		}
		if err != nil || r.ResultFlags != want {
			t.Fatalf("step %d: %+v %v", i, r, err)
		}
	}
	skill.ID = 3
	r, err := rt.resolveCombat(player, skill, a, d)
	if err != nil || r.ResultFlags != 2 {
		t.Fatal("different skill reused old history")
	}
	rt.Monsters.ApplyDamage(testDivision, target.Gid, target.CurrentHP)
	rt.retireMonsterCriticals()
	if _, ok := rt.criticals.actors[monster]; ok {
		t.Fatal("dead monster history survived")
	}
	if _, ok := rt.criticals.actors[player]; !ok {
		t.Fatal("monster retirement erased player history")
	}
}
