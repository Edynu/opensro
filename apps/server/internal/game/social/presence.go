// Package social provides the process-wide live-character directory shared by
// the independent social feature packages below it.
package social

import (
	"strings"

	"opensro.online/server/internal/transport"
)

// Directory is a stateless view over the Hub's exclusive character bindings.
// It owns no parallel session map, so transport lifecycle remains the single
// source of truth for whether a character is online.
type Directory struct {
	hub *transport.Hub
}

// NewDirectory exposes live character bindings from hub.
func NewDirectory(hub *transport.Hub) *Directory {
	return &Directory{hub: hub}
}

// BindKey composes the identity claimed by Hub.BindExclusive.
func BindKey(divisionID, characterName string) string {
	return divisionID + ":" + strings.ToLower(characterName)
}

// SessionByName returns the session currently driving a character.
func (directory *Directory) SessionByName(
	divisionID string,
	characterName string,
) (*transport.Session, bool) {
	if directory == nil || directory.hub == nil {
		return nil, false
	}
	return directory.hub.BoundSession(BindKey(divisionID, characterName))
}

// OnlineByName reports whether a character has a live exclusive binding.
func (directory *Directory) OnlineByName(divisionID, characterName string) bool {
	_, online := directory.SessionByName(divisionID, characterName)
	return online
}
