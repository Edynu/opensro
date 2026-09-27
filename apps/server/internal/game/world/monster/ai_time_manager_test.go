package monster

import "testing"

func timerDraws(t *testing.T, values ...uint32) (func() uint32, func()) {
	t.Helper()
	index := 0
	return func() uint32 {
			if index >= len(values) {
				t.Fatal("unexpected random draw")
			}
			value := values[index]
			index++
			return value
		}, func() {
			t.Helper()
			if index != len(values) {
				t.Fatalf("consumed %d random draws, want %d", index, len(values))
			}
		}
}

func TestAITimerInitializationAllFlagBytesAndDrawConsumption(t *testing.T) {
	for flags := 0; flags <= 255; flags++ {
		base, modulo := uint32(1000), uint32(491)
		if flags&0x84 != 0 {
			base, modulo = 200, 41
		}
		for _, sample := range []struct{ first, second, want uint32 }{
			{0, 0, base + 1},
			{modulo - 1, modulo + 8, base + modulo + 9},
			{0, 19, base + 10}, // second modulo, not direct jitter addition
		} {
			m := NewAITimeManager()
			next, consumed := timerDraws(t, sample.first, sample.second, 12345)
			m.InitAcquisitionTimer(uint8(flags), next)
			consumed()
			entry := m.GetTimer(TimerIDAcquisition)
			if entry.IntervalMs != sample.want || !entry.ArmedImmediate || entry.LastCheckMs != 0 {
				t.Fatalf("flags=%02x: %+v, want interval %d armed at zero", flags, entry, sample.want)
			}
		}
	}
}

func TestAITimerUnsignedGateCounterexamples(t *testing.T) {
	for _, c := range []struct {
		name                string
		now, interval, last uint32
		armed, want         bool
	}{
		{"immediate", 1000, 225, 1000, true, true},
		{"before", 1224, 225, 1000, false, false},
		{"at", 1225, 225, 1000, false, true},
		{"after", 1226, 225, 1000, false, true},
		{"startup underflow", 1, 225, 0, false, true},
		{"rollover before", 15, 32, 0xfffffff0, false, false},
		{"rollover exact expiry", 16, 32, 0xfffffff0, false, true},
		{"rollover subtraction stops wrapping", 32, 32, 0xfffffff0, false, false},
		{"high unsigned timestamp", 0x80000000, 1, 0, false, true},
		{"zero period", 0, 0, 0, false, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			entry := AITimerEntry{ArmedImmediate: c.armed, IntervalMs: c.interval, LastCheckMs: c.last}
			before := entry
			if got := fireAITimer(&entry, c.now); got != c.want {
				t.Fatalf("fire=%v, want %v", got, c.want)
			}
			if c.want {
				if entry.ArmedImmediate || entry.LastCheckMs != c.now {
					t.Fatalf("fire did not commit: %+v", entry)
				}
			} else if entry != before {
				t.Fatalf("closed gate mutated timer: %+v -> %+v", before, entry)
			}
		})
	}
}

func TestAITimerSelectedGateAndRequestedAlias(t *testing.T) {
	m := NewAITimeManager()
	zero := func() uint32 { return 0 }
	m.SetTimer(1, 225, 0, 0, true, zero)
	m.SetTimer(2, 50, 0, 0, false, zero)
	if m.CheckTimer(1, 1000) {
		t.Fatal("selected=requested must recheck the newly consumed timer")
	}
	if m.selected.active || m.GetTimer(1).LastCheckMs != 1000 {
		t.Fatal("selected alias not consumed/cleared")
	}
	m.SetTimer(1, 225, 0, 0, true, zero)
	m.SetTimer(1, 300, 0, 0, false, zero)
	if !m.CheckTimer(2, 1000) || m.GetTimer(1).IntervalMs != 300 {
		t.Fatal("selection lost replacement identity")
	}
	// Gate precedes lookup, even for an invalid requested ID.
	m.SetTimer(10, 100, 0, 2000, true, zero)
	if m.CheckTimer(9, 2050) || !m.selected.active {
		t.Fatal("closed selected gate must suppress requested lookup")
	}
	if !m.CheckTimer(2, 2100) || m.selected.active {
		t.Fatal("expired selected gate must release request")
	}
}

func TestAITimerBankInitializationOverflowAndSnapshotIsolation(t *testing.T) {
	m := NewAITimeManager()
	next, consumed := timerDraws(t, 17, 307)
	if result := m.SetTimer(10, 100, 10, 0xfffffff0, false, next); result != 2 {
		t.Fatalf("second-bank EAX=%d, want 2", result)
	}
	consumed()
	entry := m.GetTimer(10)
	if entry.IntervalMs != 108 || entry.LastCheckMs != 75 || entry.ArmedImmediate {
		t.Fatalf("second-bank phase/unsigned timestamp incorrect: %+v", entry)
	}
	entry.IntervalMs = 999
	if m.GetTimer(10).IntervalMs != 108 {
		t.Fatal("snapshot mutation escaped")
	}
	next, consumed = timerDraws(t, 0, 7)
	if result := m.SetTimer(1, 0xffffffff, 1, 0, false, next); result != 7 {
		t.Fatalf("first-bank EAX=%d, want 7", result)
	}
	consumed()
	if m.GetTimer(1).IntervalMs != 1 {
		t.Fatal("wrapped interval must clamp after arithmetic")
	}
}

func TestAITimerRejectsInvalidBanksAndRandomSources(t *testing.T) {
	for _, id := range []AITimerID{-1, 9, 12, 0x7fffffff} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("invalid ID %d did not fail closed", id)
				}
			}()
			NewAITimeManager().CheckTimer(id, 1000)
		}()
	}
	for _, next := range []func() uint32{nil, func() uint32 { return 32768 }} {
		func() {
			defer func() {
				if recover() == nil {
					t.Error("invalid RNG did not fail closed")
				}
			}()
			NewAITimeManager().InitAcquisitionTimer(4, next)
		}()
	}
}
