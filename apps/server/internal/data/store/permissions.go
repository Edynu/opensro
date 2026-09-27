package store

import (
	"fmt"
	"os"
	"path/filepath"

	"opensro.online/server/internal/platform/privatepath"
)

const authorityDirMode os.FileMode = 0o700

// ensureAuthorityDirectory makes the directory itself the confidentiality
// boundary for the database, WAL, backups, manifests, locks and quarantine
// generations. Chmod also tightens an existing directory created by an older
// build with broader permissions.
func ensureAuthorityDirectory(dir string) error {
	if err := os.MkdirAll(dir, authorityDirMode); err != nil {
		return err
	}
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory")
	}
	if err := privatepath.ProtectDirectory(dir); err != nil {
		return err
	}
	return protectExistingAuthorityFiles(dir)
}

func protectExistingAuthorityFiles(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("authority directory contains unsupported symlink %q", entry.Name())
		}
		if !info.Mode().IsRegular() {
			continue
		}
		if err := privatepath.ProtectFile(filepath.Join(dir, entry.Name())); err != nil {
			return fmt.Errorf("securing %q: %w", entry.Name(), err)
		}
	}
	return nil
}
