package enterworld

import (
	"bytes"
	"opensro.online/server/internal/domain"
	"opensro.online/server/internal/game/item/wire"
	"testing"
)

func TestCOSPetRestorationIncludesBehaviorAndSummonSlot(t *testing.T) {
	for _, band := range []uint16{3, 4} {
		cos := &CharacterCOS{GID: 7, RefObjID: 102, CurrentHP: 100, CurrentMP: 50, Name: "pet", CommandMode: 0xc7, Experience: 0x123456789abcdef0, Level: 40, Satiety: 9999, InventorySlot: 14}
		ref := &CharacterRef{RefObjID: 102, TidWord: band<<11 | 0x1c6}
		got, e := BuildCOSRecord(cos, ref, nil)
		if e != nil {
			t.Fatal(e)
		}
		want := wire.NewWriter(50).U32(7).U32(102).U32(100).U32(50)
		if band == 3 {
			want.U64(0x123456789abcdef0).U8(40).U16(9999)
		}
		want.U32(0xc7).U16(3).Bytes([]byte("pet")).U8(0).U32(0).U8(14)
		if !bytes.Equal(got, want.Payload()) {
			t.Fatalf("band %d: %x", band, got)
		}
		cos.Container = &domain.COSContainer{Capacity: 141}
		if _, e = BuildCOSRecord(cos, ref, nil); e == nil {
			t.Fatal("overruns native five-page COS storage")
		}
	}
}
