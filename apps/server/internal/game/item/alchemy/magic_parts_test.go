package alchemy

import (
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestMagicBodyPartRestrictionsAcrossArmorFamilies(t *testing.T) {
	for _, group := range []uint8{1, 2, 3, 9, 10, 11} {
		for part := uint8(1); part <= 6; part++ {
			flags := wire.PackTypeFlags(3, 1, group, part)
			want := part == 1 || part == 3 || part == 4
			if got := (Magic{Categories: []string{"helm", "mail", "pants"}}).Allows(flags); got != want {
				t.Fatalf("group=%d part=%d admission=%v want=%v", group, part, got, want)
			}
			if !(Magic{Categories: []string{"armor"}}).Allows(flags) {
				t.Fatal("broad armor rule narrowed")
			}
		}
	}
	for _, flags := range []uint16{wire.PackTypeFlags(3, 1, 6, 1), wire.PackTypeFlags(3, 1, 4, 1), wire.PackTypeFlags(3, 1, 5, 1), wire.PackTypeFlags(3, 3, 1, 1)} {
		if (Magic{Categories: []string{"helm", "mail", "pants"}}).Allows(flags) {
			t.Fatalf("body part admitted unrelated item %04x", flags)
		}
	}
	if (Magic{Categories: []string{""}}).Allows(0) {
		t.Fatal("empty category admitted unknown item")
	}
}
