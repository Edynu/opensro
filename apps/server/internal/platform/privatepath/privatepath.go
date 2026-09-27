// Package privatepath applies service-private filesystem permissions using
// the host platform's real access-control mechanism.
package privatepath

// ProtectDirectory limits a directory and inherited child access to the
// current service identity plus platform administrators.
func ProtectDirectory(path string) error {
	return protect(path, true)
}

// ProtectFile limits one file to the current service identity plus platform
// administrators.
func ProtectFile(path string) error {
	return protect(path, false)
}
