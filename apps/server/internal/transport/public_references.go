package transport

import "net/http"

// SetPublicReferences connects the composition-owned immutable data resource.
// Transport only routes HTTP; it must never know gameplay catalog schemas.
func (s *Server) SetPublicReferences(handler http.Handler) {
	s.readyMu.Lock()
	defer s.readyMu.Unlock()
	s.publicReferences = handler
}
