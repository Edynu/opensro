package domain

import "testing"

func TestInitialCOSBodyStatusEveryByte(t *testing.T) {
	for value := 0; value < 256; value++ {
		want := uint8(0)
		if value == 3 || value == 4 {
			want = uint8(value)
		}
		if got := InitialCOSBodyStatus(uint8(value)); got != want {
			t.Fatalf("owner %d: got %d, want %d", value, got, want)
		}
	}
}
