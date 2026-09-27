//go:build windows

package store

// syncDir is a documented NO-OP on Windows: a directory cannot be opened
// for FlushFileBuffers the way Unix fsyncs a dirfd, and NTFS journals
// directory metadata (the rename publish) on its own schedule. Returning
// nil keeps writeFileAtomic's contract identical across platforms - the
// write must not fail on a platform that cannot sync a directory.
func syncDir(dir string) error {
	return nil
}
