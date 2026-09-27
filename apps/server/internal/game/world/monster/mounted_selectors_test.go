package monster

import "testing"

func TestMountedSelectorsKeepRelationshipAndSkillDomainsDistinct(t *testing.T) {
	for _, owner := range []uint32{0, 100} {
		for _, mount := range []uint32{0, 200, 300} {
			for _, skills := range []bool{false, true} {
				want := uint8(25)
				if owner != 0 && mount != 0 && skills {
					want = 101
				}
				if got := NativeIdleThreshold(0x19c6, skills, owner, mount); got != want {
					t.Fatalf("skills=%v owner=%d mount=%d got=%d", skills, owner, mount, got)
				}
				if got := NativeIdleThreshold(0x00c6, skills, owner, mount); got != 25 {
					t.Fatal("monster inherited COS owner selector")
				}
			}
		}
	}
	for _, tid := range []uint16{0x29c6, 0x41c6, 0x2246, 0x2247} {
		if NativeIdleThreshold(tid, false, 0, 0) != 101 {
			t.Fatalf("lost independent class %04x", tid)
		}
	}
	if !NativeControllerMountExcludesFollow(200, true, 200) ||
		NativeControllerMountExcludesFollow(200, true, 300) ||
		NativeControllerMountExcludesFollow(200, false, 200) ||
		NativeControllerMountExcludesFollow(0, true, 0) {
		t.Fatal("mount exclusion lost actor/player identity")
	}
}
