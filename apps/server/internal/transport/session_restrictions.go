package transport

import "sync"

// These IDs are the native CCmdSrcNet record selectors, not wire notice kinds.
const (
	CommandRestrictionTrade uint8 = 3
	CommandRestrictionChat  uint8 = 4
)

type sessionCommandRestrictions struct {
	mu      sync.RWMutex
	enabled [2]bool
	until   [2][8]uint16
}

// SetCommandRestriction mirrors 40B7F0: retain the enabled flag and the exact
// eight SYSTEMTIME words. No clock interpretation or normalization occurs.
// Only authenticated server-side moderation should invoke this method.
func (s *Session) SetCommandRestriction(kind uint8, until [8]uint16) bool {
	if kind < 3 || kind > 4 {
		return false
	}
	s.restrictions.mu.Lock()
	defer s.restrictions.mu.Unlock()
	s.restrictions.until[kind-3] = until
	s.restrictions.enabled[kind-3] = true
	return true
}

// ClearCommandRestriction mirrors 40B840. Expiry is controlled by the owner
// that installs/clears restrictions, not a request handler's local clock.
func (s *Session) ClearCommandRestriction(kind uint8) bool {
	if kind < 3 || kind > 4 {
		return false
	}
	s.restrictions.mu.Lock()
	defer s.restrictions.mu.Unlock()
	s.restrictions.enabled[kind-3] = false
	return true
}

// CommandRestriction returns a detached date only when its record is enabled.
func (s *Session) CommandRestriction(kind uint8) (until [8]uint16, enabled bool) {
	if kind < 3 || kind > 4 {
		return until, false
	}
	s.restrictions.mu.RLock()
	defer s.restrictions.mu.RUnlock()
	if !s.restrictions.enabled[kind-3] {
		return until, false
	}
	return s.restrictions.until[kind-3], true
}
