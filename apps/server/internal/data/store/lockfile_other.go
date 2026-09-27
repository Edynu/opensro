//go:build !windows

package store

import (
	"os"
	"syscall"
)

// processCreationUnixMilli is unavailable off Windows; ok=false keeps the
// liveness-only behavior (this project deploys on Windows - the check is
// a hardening for the box the kill model actually runs on).
func processCreationUnixMilli(pid int) (int64, bool) {
	return 0, false
}

func processAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return process.Signal(syscall.Signal(0)) == nil
}

// lockFileExclusive takes the process-lifetime exclusive lock on the
// authority lock file: advisory flock, LOCK_NB so a held lock refuses
// instead of blocking. The OS releases it on ANY process death - the
// kill model's free stale-lock reclaim.
func lockFileExclusive(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

// unlockFileExclusive releases lockFileExclusive's hold (the last claim
// holder's Close; a killed process needs no call - the OS drops it).
func unlockFileExclusive(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}
