package monster

import "testing"

func TestActivityCadenceNativeBoundaries(t *testing.T) {
	for _, start := range []uint32{0, 10000, 0xffffff00} {
		for _, random := range []uint32{0, 999, 1000, 32767} {
			a := NewActivityCadence(start, random)
			interval := uint32(random%1000 + 1000)
			if uint32(a.Interval) != interval || a.Due(start+interval) || a.LastCheck != start {
				t.Fatalf("equality advanced: %+v", a)
			}
			if !a.Due(start+interval+1) || a.LastCheck != start+interval+1 {
				t.Fatalf("expired cadence not consumed: %+v", a)
			}
			if a.Due(start + interval + 2) {
				t.Fatal("empty activity query rearmed cadence")
			}
		}
	}
}

func TestActivityAdmissionIsSpecificToWander(t *testing.T) {
	for flags := uint32(0); flags < 256; flags++ {
		for mode := MoverMode(0); mode < moverModeCount; mode++ {
			for _, controlled := range []bool{false, true} {
				want := mode == MoverWandering && flags&0x84 == 0 && !controlled
				if MaySuspendWander(flags, controlled, mode) != want {
					t.Fatalf("flags=%x mode=%s controlled=%v", flags, mode, controlled)
				}
			}
		}
	}
}
