package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"reflect"
	"testing"
)

func TestCOSBehaviorOwnershipFamilyAndCommit(t *testing.T) {
	c := testCharacter()
	refs := testCosSource(testItems())
	refs.characters["PET"] = &enterworld.CharacterRef{Codename: "PET", RefObjID: 9, TidWord: 0x21c6}
	rt, _ := newTestRuntime(c, refs)
	gid, _ := enterworld.CosObjectIDForCharacter(c)
	c.ActiveCOS = &enterworld.CharacterCOS{GID: gid, RefObjID: 9, Codename: "PET", CurrentHP: 100, Summoned: true, CommandMode: 0x47}
	p := wire.NewWriter(9).U32(gid).U8(2).U32(0xc7).Payload()
	r := rt.HandleCosBehavior(testDivision, c, p)
	if c.ActiveCOS.CommandMode != 0xc7 || len(r.Frames) != 1 || !reflect.DeepEqual(r.Frames[0].Payload, append([]byte{1}, p...)) || len(r.Broadcast) != 0 {
		t.Fatalf("behavior commit %+v", r)
	}
	before := c.Snapshot()
	for _, bad := range [][]byte{p[:8], append(append([]byte(nil), p...), 0), wire.NewWriter(9).U32(gid + 1).U8(2).U32(0).Payload(), wire.NewWriter(9).U32(gid).U8(1).U32(0).Payload(), wire.NewWriter(9).U32(gid).U8(2).U32(0x100).Payload()} {
		if got := rt.HandleCosBehavior(testDivision, c, bad); len(got.Frames) != 0 || !reflect.DeepEqual(c.Snapshot(), before) {
			t.Fatal("invalid behavior changed state")
		}
	}
	c.ActiveCOS.Summoned = false
	before = c.Snapshot()
	rt.HandleCosBehavior(testDivision, c, p)
	if !reflect.DeepEqual(c.Snapshot(), before) {
		t.Fatal("desummoned COS mutated")
	}
}
