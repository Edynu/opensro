package wait

import (
	"sync/atomic"
	"testing"
	"time"
)

// recorder captures Fatalf instead of stopping the goroutine, so the tests
// can assert on the helpers' own failures.
type recorder struct {
	testing.TB
	failed atomic.Bool
}

func (r *recorder) Helper() {}

func (r *recorder) Fatalf(string, ...any) { r.failed.Store(true) }

func TestEventuallyReturnsOnceTheConditionHolds(t *testing.T) {
	var flag atomic.Bool
	go func() { flag.Store(true) }()
	rec := &recorder{TB: t}
	Eventually(rec, time.Second, "flag", flag.Load)
	if rec.failed.Load() {
		t.Fatal("Eventually failed although the condition became true")
	}
}

func TestEventuallyFailsWithTheDescriptionAfterTheTimeout(t *testing.T) {
	rec := &recorder{TB: t}
	start := time.Now()
	Eventually(rec, 20*time.Millisecond, "never", func() bool { return false })
	if !rec.failed.Load() {
		t.Fatal("Eventually did not fail on a condition that never holds")
	}
	if time.Since(start) < 20*time.Millisecond {
		t.Fatal("Eventually gave up before its timeout")
	}
}

func TestConsistentlySpendsTheWindowAndFailsOnAViolation(t *testing.T) {
	rec := &recorder{TB: t}
	start := time.Now()
	Consistently(rec, 20*time.Millisecond, "steady", func() bool { return true })
	if rec.failed.Load() || time.Since(start) < 20*time.Millisecond {
		t.Fatal("Consistently did not hold the full window for a steady condition")
	}

	rec = &recorder{TB: t}
	calls := 0
	Consistently(rec, time.Second, "flips", func() bool { calls++; return calls < 3 })
	if !rec.failed.Load() {
		t.Fatal("Consistently missed a violation")
	}
}
