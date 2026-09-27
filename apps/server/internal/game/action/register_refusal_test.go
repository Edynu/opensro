package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/transport"
	"testing"
)

func TestUnboundActionCannotDispatchOrInventInventoryReply(t *testing.T) {
	rt := &Runtime{}
	called := false
	handler := rt.hubHandler(nil, func(string, *enterworld.Character, []byte) OpResult { called = true; return OpResult{} })
	// No transport owner: any attempted send is an error, as is operation entry.
	// The binding guard must finish before either dependency is needed.
	for _, opcode := range []uint16{0x7495, 0x72dd, 0x705b, 0x77e7, 0x706d, 0x72cd, 0x75bd, 0x769e, 0x3053, 0x7427} {
		handler(&transport.Session{ID: 1}, opcode, nil)
	}
	if called {
		t.Fatal("unbound request reached gameplay authority")
	}
}
