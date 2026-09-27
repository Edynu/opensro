/*
===========================================================================

wait.go - the one place tests wait on asynchronous work

End-to-end tests drive real sockets, goroutines and close hooks, so some
results arrive after the call that caused them. Tests wait for those
through this package instead of sleeping: Eventually polls until a
condition holds, Consistently proves a condition keeps holding for a
window (an absence, such as "no handler ran"). Both fail with the caller's
description, so a timeout names what never happened.

Logic that depends on elapsed time does not belong here; drive it with the
simulation tick or an injected clock. This package imports nothing from the
module, so any package's tests can use it without an import cycle.

===========================================================================
*/
package wait

import (
	"testing"
	"time"
)

// PollInterval is short enough to keep tests fast and long enough not to
// spin a core while another goroutine does the work being waited for.
const PollInterval = 5 * time.Millisecond

/*
==================
Eventually

Polls cond until it returns true, failing the test once timeout has passed.
cond runs at least once, and once more after the deadline, so a result that
lands during the last interval is not reported as a timeout.
==================
*/
func Eventually(t testing.TB, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if cond() {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out after %v waiting for %s", timeout, what)
			return
		}
		time.Sleep(PollInterval) // the one sanctioned poll wait for all tests
	}
}

/*
==================
Consistently

Checks cond for the whole window and fails at the first poll where it no
longer holds. It proves an absence ("nothing was dispatched"), so it always
spends the full window when the test passes.
==================
*/
func Consistently(t testing.TB, window time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(window)
	for {
		if !cond() {
			t.Fatalf("%s stopped holding within %v", what, window)
			return
		}
		if time.Now().After(deadline) {
			return
		}
		time.Sleep(PollInterval) // the one sanctioned poll wait for all tests
	}
}
