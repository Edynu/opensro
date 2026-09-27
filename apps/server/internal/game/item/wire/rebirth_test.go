package wire

import "testing"

func TestDecodeLocalRebirthRequest(t *testing.T) {
	for _, choice := range []uint8{RebirthAtSpecifiedPoint, RebirthAtPresentPoint} {
		got, err := DecodeLocalRebirthRequest([]byte{choice})
		if err != nil || got != choice {
			t.Fatalf("choice %d decoded as %d, err=%v", choice, got, err)
		}
	}
	for _, payload := range [][]byte{nil, {}, {0}, {3}, {1, 2}} {
		if _, err := DecodeLocalRebirthRequest(payload); err == nil {
			t.Fatalf("payload %v unexpectedly decoded", payload)
		}
	}
}
