package monster

import "testing"

func TestHostilityStatusBranches(t *testing.T) {
	for status := 0; status < 256; status++ {
		for _, tid := range []uint16{0xc6, 0x8c6, 0x1c6, 0xc4, 0x86} {
			for _, flags := range []uint32{0, 0x200, 0x80000200} {
				actor := HostilityObserver{TID: tid, ReferenceFlags: flags, Mode: 1}
				target := HostilityTarget{GID: 17, Player: true, BodyStatus: uint8(status)}
				want := status < 2 || status > 4
				if status == 6 || status == 7 {
					want = (tid == 0xc6 || tid == 0x8c6) && flags&0x200 != 0
				}
				if got := AllowsHostility(actor, target); got != want {
					t.Fatalf("status=%d tid=%x flags=%x got=%v want=%v", status, tid, flags, got, want)
				}
			}
		}
	}
}

func TestHostilityRestrictionsAndDetectionOrder(t *testing.T) {
	actor := HostilityObserver{TID: 0x8c6, Mode: 1, ReferenceFlags: 0x200,
		RestrictionD34: 0x200, Restriction118C: true, ExcludedGID: 17,
		HasBoundTarget: true, BoundTargetGID: 18}
	target := HostilityTarget{GID: 17, Player: true}
	if AllowsHostility(actor, target) {
		t.Fatal("excluded ordinary target accepted")
	}
	target.BodyStatus = 6
	if !AllowsHostility(actor, target) {
		t.Fatal("detected status must skip the two base restriction checks")
	}
	for _, change := range []func(*HostilityTarget){
		func(v *HostilityTarget) { v.GID = 0 },
		func(v *HostilityTarget) { v.RejectedType43C = true },
		func(v *HostilityTarget) { v.RestrictionC44 = true },
		func(v *HostilityTarget) { v.RejectedType3C = true },
	} {
		copy := target
		change(&copy)
		if AllowsHostility(actor, copy) {
			t.Fatalf("detection bypassed unconditional restriction: %+v", copy)
		}
	}
	actor.Restriction118C = false
	target.BodyStatus = 0
	if AllowsHostility(actor, target) {
		t.Fatal("bound target restriction ignored")
	}
	target.GID = 18
	if !AllowsHostility(actor, target) {
		t.Fatal("bound target rejected")
	}
}

func TestHostilityProtectionDirectionModeAndRarity(t *testing.T) {
	for rarity := 0; rarity < 16; rarity++ {
		for mask := uint32(0); mask < 16; mask++ {
			for _, level := range []uint8{0, 19, 20, 21, 255} {
				actor := HostilityObserver{TID: 0x8c6, Mode: 1, Rarity: uint8(rarity), Level: level}
				target := HostilityTarget{GID: 17, Player: true, ProtectionActive: true, ProtectionMask: mask, ProtectionLevel: 20}
				protectedRarity := (rarity == 0 && mask&1 != 0) || (rarity == 1 && mask&2 != 0) ||
					(rarity == 3 && mask&4 != 0) || (rarity == 6 && mask&8 != 0)
				want := !protectedRarity || level > 20
				if got := AllowsHostility(actor, target); got != want {
					t.Fatalf("rarity=%d mask=%x actor level=%d got=%v want=%v", rarity, mask, level, got, want)
				}
				actor.Mode = 0
				if !AllowsHostility(actor, target) {
					t.Fatal("mode zero did not bypass protection")
				}
				actor.Mode, actor.TID = 1, 0xc6
				if !AllowsHostility(actor, target) {
					t.Fatal("protection applied to wrong actor subtype")
				}
			}
		}
	}
}
