package monster

import "testing"

func TestHiveDensityNativeHistoryAndClamp(t *testing.T) {
	p := HiveDensityPolicy{Kind: 1, MonstersPerPC: 30, Step: 30, Maximum: 80}
	var d HiveDensity
	for i, want := range []float32{0, 30, 30, 60, 60, 80} {
		count := uint32(8)
		if i >= 4 {
			count = 80
		}
		if got := d.Sample(count, 4, p); got != want {
			t.Fatalf("sample %d = %v, want %v", i, got, want)
		}
	}
	if p.Denominator(119) != 3 {
		t.Fatal("denominator must truncate before density division")
	}
	if d.Sample(100, 0, p) != 0 {
		t.Fatal("zero divisor low-dword conversion")
	}
}

func TestHiveDensityUnsignedOverflow(t *testing.T) {
	p := HiveDensityPolicy{Step: 0x80000000, Maximum: 0xffffffff}
	var d HiveDensity
	d.Sample(8, 1, p)
	if got := d.Sample(8, 1, p); got != 0 {
		t.Fatalf("IMUL low dword changed: %v", got)
	}
}
