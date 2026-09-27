package store

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"opensro.online/server/internal/game/enterworld"
)

// TestTornWriteNeverCorrupts simulates the killer landing inside a write:
// (A) mid-write - a partial temp file; (B) after fsync but before rename -
// a complete temp file that never became the state. Both must leave the
// last committed state fully readable and self-clean the stray.
func TestTornWriteNeverCorrupts(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	clock := newTestClock()

	s1 := openTest(t, dir, clock)
	if err := s1.CreateCharacter(testDivision, "test-account", seededCharacter()); err != nil {
		t.Fatal(err)
	}
	s1.Close()

	// Strays beside the database come from the bak-restore/manifest
	// writers (writeFileAtomic); a reaped writer can only strand these,
	// never tear a target. Database commits themselves are transactional
	// (WAL recovery handles a kill mid-commit by construction).
	scenarios := map[string][]byte{
		"kill mid-write":      []byte(`TORN partial bytes`),
		"kill before rename":  []byte(`complete but never renamed`),
		"kill with empty tmp": {},
	}
	for name, strayPayload := range scenarios {
		t.Run(name, func(t *testing.T) {
			strayPath := filepath.Join(dir, DBFileName+".tmp-killed123")
			if err := os.WriteFile(strayPath, strayPayload, 0o644); err != nil {
				t.Fatal(err)
			}

			s := openTest(t, dir, clock)
			loaded := s.Characters().CharactersForDivision(testDivision)
			if len(loaded) != 1 || loaded[0].Name != "asd2fixture" {
				t.Fatalf("state lost after %s: %+v", name, loaded)
			}
			if _, err := os.Stat(strayPath); !os.IsNotExist(err) {
				t.Fatalf("stray temp must self-clean at open (%s)", name)
			}
			s.Close()
		})
	}
}

// TestLockRefusesSecondWriter: the authority.lock is PID-liveness based -
// a LIVE foreign owner refuses (dual-writer guard, first-landing rule per
// the ratification post); a DEAD owner's lock is stale and replaced with
// a warning, because the kill model guarantees no graceful cleanup ever
// runs.
func TestLockRefusesSecondWriter(t *testing.T) {
	t.Parallel()
	clock := newTestClock()

	t.Run("live foreign pid refuses", func(t *testing.T) {
		dir := t.TempDir()
		// The parent of the test binary (the go test orchestrator) is a
		// real, live, foreign process for the duration of this test. The
		// lock's write instant sits AFTER the parent's creation time, so
		// the recycled-PID unmasking sees a legitimate owner.
		lock, err := json.Marshal(lockFilePayload{PID: os.Getppid(), StartedAt: time.Now().UnixMilli()})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, LockFileName), lock, 0o644); err != nil {
			t.Fatal(err)
		}
		_, err = Open(dir, Options{Now: clock.Now})
		if err == nil {
			t.Fatal("a live foreign lock holder must refuse the open")
		}
		if !strings.Contains(err.Error(), "locked by live pid") {
			t.Fatalf("refusal must name the live owner: %v", err)
		}
	})

	t.Run("recycled pid is stale despite being alive", func(t *testing.T) {
		if runtime.GOOS != "windows" {
			t.Skip("creation-time unmasking is the Windows deploy-box hardening")
		}
		dir := t.TempDir()
		// A live pid (the parent) behind a lock written BEFORE that
		// process was born: exactly what PID recycling produces after a
		// process exit. The liveness check
		// alone would refuse and crash-loop the watchdog reboot; the
		// creation-time comparison must unmask it as stale.
		lock, err := json.Marshal(lockFilePayload{PID: os.Getppid(), StartedAt: 1})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, LockFileName), lock, 0o644); err != nil {
			t.Fatal(err)
		}
		s, err := Open(dir, Options{Now: clock.Now, DefaultSkills: testSkillSeeder})
		if err != nil {
			t.Fatalf("a recycled-pid lock must be stale, not a crash-looping refusal: %v", err)
		}
		t.Cleanup(s.Close)
		if err := s.CreateCharacter(testDivision, "test-account", &enterworld.Character{Name: "postrecycle"}); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("dead pid is stale and replaced", func(t *testing.T) {
		dir := t.TempDir()
		// A real process that has provably exited donates a dead PID.
		probe := exec.Command("go", "version")
		if err := probe.Run(); err != nil {
			t.Skipf("cannot spawn probe process: %v", err)
		}
		deadPID := probe.ProcessState.Pid()

		lock, err := json.Marshal(lockFilePayload{PID: deadPID, StartedAt: 1})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, LockFileName), lock, 0o644); err != nil {
			t.Fatal(err)
		}
		s, err := Open(dir, Options{Now: clock.Now, DefaultSkills: testSkillSeeder})
		if err != nil {
			t.Fatalf("a dead owner's lock is stale and must not block the boot: %v", err)
		}
		t.Cleanup(s.Close)
		if err := s.CreateCharacter(testDivision, "test-account", &enterworld.Character{Name: "poststale"}); err != nil {
			t.Fatal(err)
		}

		// The lock now names US.
		payload, err := os.ReadFile(filepath.Join(dir, LockFileName))
		if err != nil {
			t.Fatal(err)
		}
		owner := lockFilePayload{}
		if err := json.Unmarshal(payload, &owner); err != nil {
			t.Fatal(err)
		}
		if owner.PID != os.Getpid() {
			t.Fatalf("lock owner = %d, want this process %d", owner.PID, os.Getpid())
		}
	})

	t.Run("second in-process open refuses regardless of posture", func(t *testing.T) {
		// The single-writer guard covers PROCESSES two ways: the OS
		// advisory lock on authority.lock (taken before the pid payload
		// is read or written, so two racing openers serialize instead of
		// both passing a read-then-write window; released by the OS on
		// any death) and the pid-liveness payload for writers that hold
		// no OS lock. IN-process, claimAuthority refuses a second Open
		// of the same directory UNCONDITIONALLY - two live Store
		// instances writing one state.db is a corruption path no posture
		// legitimizes. A restart is modeled by Close-then-Open (the next
		// subtest).
		dir := t.TempDir()
		openTest(t, dir, clock)
		for name, opts := range map[string]Options{
			"dev":        {Now: clock.Now, DefaultSkills: testSkillSeeder},
			"production": {Now: clock.Now, RequireStore: true, DefaultSkills: testSkillSeeder},
		} {
			_, err := Open(dir, opts)
			if err == nil {
				t.Fatalf("%s: a second Open of a directory already open in this process must refuse (two live writers to one state.db)", name)
			}
			if !strings.Contains(err.Error(), "already open in this process") {
				t.Fatalf("%s: the refusal must name the in-process conflict: %v", name, err)
			}
		}
	})

	t.Run("sequential reopen after Close stays legal", func(t *testing.T) {
		dir := t.TempDir()
		s := openTest(t, dir, clock)
		if err := s.CreateCharacter(testDivision, "test-account", &enterworld.Character{Name: "reopenseq"}); err != nil {
			t.Fatal(err)
		}
		s.Close() // releases the claim AND the OS lock
		s2 := openTest(t, dir, clock)
		if got := len(s2.Characters().CharactersForDivision(testDivision)); got != 1 {
			t.Fatalf("sequential reopen lost state: %d records", got)
		}
	})

	t.Run("os lock refuses a second handle", func(t *testing.T) {
		// The mechanism itself, platform-independent: while one handle
		// holds the exclusive lock, a second handle (a second process in
		// real life - flock/LockFileEx arbitrate per handle) must fail
		// immediately, and a released lock must be reacquirable. This is
		// the cross-process TOCTOU guard acquireLock rides.
		dir := t.TempDir()
		path := filepath.Join(dir, LockFileName)
		first, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		defer first.Close()
		if err := lockFileExclusive(first); err != nil {
			t.Fatalf("first exclusive lock: %v", err)
		}
		second, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		defer second.Close()
		if err := lockFileExclusive(second); err == nil {
			t.Fatal("a second handle must not acquire the exclusive lock while the first holds it")
		}
		if err := unlockFileExclusive(first); err != nil {
			t.Fatal(err)
		}
		if err := lockFileExclusive(second); err != nil {
			t.Fatalf("the lock must be reacquirable after release: %v", err)
		}
		if err := unlockFileExclusive(second); err != nil {
			t.Fatal(err)
		}
	})
}
