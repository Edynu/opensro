/*
===========================================================================

durability.go - when the store flushes writes to the storage medium

===========================================================================
*/

package store

import (
	"os"
	"testing"
)

/*
==================
flushToMedia

flushToMedia reports whether the store asks the OS to flush its writes to
the storage medium (File.Sync, SQLite's synchronous level). Those flushes
buy power-loss durability only: a killed or crashed process loses nothing
the OS already accepted, and every crash contract the store promises a
running process (atomic renames, WAL commits, lock ownership) holds without
them. Test binaries exercise exactly those process-level contracts and
thousands of store boots, where Windows FlushFileBuffers dominates the run,
so they skip media flushes. Production binaries always flush.
==================
*/
func flushToMedia() bool {
	return !testing.Testing()
}

// syncFile is File.Sync under the media-flush policy.
func syncFile(f *os.File) error {
	if !flushToMedia() {
		return nil
	}
	return f.Sync()
}

// sqliteSynchronous is the PRAGMA synchronous level for a configured handle.
func sqliteSynchronous() string {
	switch {
	case !flushToMedia():
		return "OFF"
	case os.Getenv(EnvSyncFull) == "1":
		return "FULL"
	default:
		return "NORMAL"
	}
}
