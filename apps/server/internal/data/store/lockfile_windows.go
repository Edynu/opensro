//go:build windows

package store

import (
	"os"

	"golang.org/x/sys/windows"
)

// lockByteOffset places the exclusive lock range far past any real
// payload byte. Windows file locks are MANDATORY: locking byte 0 would
// make the diagnostic JSON unreadable to every other handle (the
// migration tool inspecting the owner, tests reading the pid), so the
// lock claims one byte at an offset the payload never reaches - the
// same trick SQLite's win32 VFS uses for its lock bytes.
const (
	lockByteOffset         = 0x7ffffffe
	windowsStillActiveCode = uint32(259)
)

// lockFileExclusive takes the process-lifetime exclusive lock on the
// authority lock file: LockFileEx with FAIL_IMMEDIATELY so a held lock
// refuses instead of blocking. The OS releases it on ANY process death -
// the kill model's free stale-lock reclaim.
func lockFileExclusive(f *os.File) error {
	overlapped := &windows.Overlapped{Offset: lockByteOffset}
	return windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, overlapped)
}

// unlockFileExclusive releases lockFileExclusive's range (the last claim
// holder's Close; a killed process needs no call - the OS drops it).
func unlockFileExclusive(f *os.File) error {
	overlapped := &windows.Overlapped{Offset: lockByteOffset}
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, overlapped)
}

// processCreationUnixMilli returns the CREATION time of pid, or ok=false
// when it cannot be read (process gone, access denied). Used to unmask
// recycled PIDs: a process born AFTER the lock was written cannot be the
// lock's owner, however alive it is. Without this check a recycled PID can
// crash-loop the gateway until an operator deletes the lock by hand.
func processCreationUnixMilli(pid int) (int64, bool) {
	const maxWindowsPID = uint64(1<<32 - 1)
	if pid <= 0 || uint64(pid) > maxWindowsPID {
		return 0, false
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return 0, false
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	var creation, exit, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &creation, &exit, &kernel, &user); err != nil {
		return 0, false
	}
	return creation.Nanoseconds() / 1e6, true
}

// processAlive distinguishes a running process from an exited process object
// whose PID can still be opened while Windows drains the last handle. The
// latter is common immediately after `go run` returns and must not turn a
// clean sequential operator command into a false live-writer refusal.
func processAlive(pid int) bool {
	const maxWindowsPID = uint64(1<<32 - 1)
	if pid <= 0 || uint64(pid) > maxWindowsPID {
		return false
	}
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer func() { _ = windows.CloseHandle(handle) }()
	return processHandleAlive(handle)
}

func processHandleAlive(handle windows.Handle) bool {
	var exitCode uint32
	return windows.GetExitCodeProcess(handle, &exitCode) == nil && exitCode == windowsStillActiveCode
}
