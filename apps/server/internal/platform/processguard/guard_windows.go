//go:build windows

package processguard

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

const lockByteOffset = 0x7ffffffd

func tryLock(file *os.File) error {
	overlapped := &windows.Overlapped{Offset: lockByteOffset}
	return windows.LockFileEx(
		windows.Handle(file.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0,
		1,
		0,
		overlapped,
	)
}

func lockContended(err error) bool {
	return errors.Is(err, windows.ERROR_LOCK_VIOLATION)
}

func unlock(file *os.File) error {
	overlapped := &windows.Overlapped{Offset: lockByteOffset}
	return windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, overlapped)
}
