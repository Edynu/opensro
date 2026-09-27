package wire

import (
	"reflect"
	"testing"
)

func TestCOSTransferRequestNativeShape(t *testing.T) {
	for _, kind := range []uint8{MoveTypeCosToPlayer, MoveTypePlayerToCos} {
		want := []byte{kind, 0x78, 0x56, 0x34, 0x12, 13, 2}
		q := ItemMoveRequest{MovementType: kind, CosGID: 0x12345678, SourceSlot: 13, DestSlot: 2}
		p, e := q.Encode()
		if e != nil || !reflect.DeepEqual(p, want) {
			t.Fatalf("native shape %x %v", p, e)
		}
		got, e := DecodeItemMoveRequest(want)
		if e != nil || !reflect.DeepEqual(got, q) {
			t.Fatalf("decode %+v %v", got, e)
		}
		for n := 0; n < len(want); n++ {
			if _, e = DecodeItemMoveRequest(want[:n]); e == nil {
				t.Fatalf("accepted truncation %d", n)
			}
		}
		for _, bad := range [][]byte{append(append([]byte{}, want...), 1), {kind, 0, 0, 0, 0, 13, 2}} {
			if _, e = DecodeItemMoveRequest(bad); e == nil {
				t.Fatalf("accepted malformed %x", bad)
			}
		}
	}
}
