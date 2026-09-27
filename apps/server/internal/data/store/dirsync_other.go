//go:build !windows

/*
===========================================================================

dirsync_other.go - directory sync on platforms without a native call

===========================================================================
*/

package store

import "os"

/*
==================
syncDir

syncDir fsyncs a directory so a just-renamed entry (writeFileAtomic's
publish step) survives power loss: fsyncing the FILE makes its bytes
durable, but the rename lives in the parent directory's entries, and
an unsynced directory can lose the publish while keeping the orphaned
bytes.
==================
*/
func syncDir(dir string) error {
	if !flushToMedia() {
		return nil
	}
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
