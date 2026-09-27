package domain

// ObjectScopeChange is publication metadata. The reliable queue commits it
// with the complete create/removal transaction; it is never a wire field.
type ObjectScopeChange struct {
	GID     uint32
	Visible bool
}
