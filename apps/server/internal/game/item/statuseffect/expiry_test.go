package statuseffect

import "testing"

func TestEffectExpiryPoliciesAndZeroPresence(t *testing.T) {
	for _, tc := range []struct {
		name string
		e    Effect
		at   int64
		want bool
	}{
		{"ordinary-before", Effect{ExpiresAtMs: 100}, 99, false},
		{"ordinary-equal", Effect{ExpiresAtMs: 100}, 100, false},
		{"ordinary-after", Effect{ExpiresAtMs: 100}, 101, true},
		{"imbue-equal", Effect{ExpiresAtMs: 100, Imbue: true}, 100, false},
		{"job-equal", Effect{ExpiresAtMs: 100, Persistent: true}, 100, true},
		{"absent", Effect{}, 100, false},
		{"zero-equal", Effect{DurationPresent: true}, 0, false},
		{"zero-after", Effect{DurationPresent: true}, 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.e.Expired(tc.at); got != tc.want {
				t.Fatalf("expired=%v want %v", got, tc.want)
			}
		})
	}
}

func TestNativeDurationClockWrapAndProjection(t *testing.T) {
	start := int64(0xfffffff0)
	e := Effect{DurationPresent: true, StartedAtMs: start, ExpiresAtMs: start + 32}
	for _, c := range []struct {
		at        int64
		expired   bool
		remaining uint32
	}{
		{start, false, 32}, {start + 31, false, 1}, {start + 32, false, 0}, {start + 33, true, 0},
		// The native counter and elapsed subtraction are uint32. Retain that
		// behavior even for a detached snapshot after an entire counter cycle.
		{start + 0x100000000, false, 32}, {start + 0x100000020, false, 0},
		{start - 1, true, 0},
	} {
		if e.Expired(c.at) != c.expired || e.RemainingMs(c.at) != c.remaining {
			t.Fatalf("at %x expired %v remaining %d", c.at, e.Expired(c.at), e.RemainingMs(c.at))
		}
	}
}
