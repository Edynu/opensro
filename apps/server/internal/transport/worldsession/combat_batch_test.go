package worldsession

import (
	"bytes"
	"testing"

	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/simulation"
)

func TestCombatBurstKeepsFacingResultAndDeathOnOneOrderedLane(t *testing.T) {
	srv := startServer(t)
	conn, welcome := dialAndHello(t, srv)
	session, _ := srv.Hub.Session(welcome.SessionID)
	session.SetWorldSnapshot("DIV_A", staticProvider{simulation.SessionSnapshot{DivisionID: "DIV_A", CharacterID: 7}})
	bridge := New(srv.Hub)
	frames := []simulation.Frame{
		{Opcode: wire.OpObjectSourceCorrection, Payload: make([]byte, 20)},
		{Opcode: wire.OpSkillCastResult, Payload: []byte{1}},
		{Opcode: 0x33a6, Payload: []byte{2}},
		{Opcode: wire.OpObjectStateRefresh, Payload: []byte{3}},
	}
	bridge.PushToSession(SessionIDString(welcome.SessionID), frames)
	for _, want := range frames {
		got := readFrame(t, conn)
		if got.Opcode != want.Opcode || !bytes.Equal(got.Payload, want.Payload) {
			t.Fatalf("combat burst reordered: got %04x %x, want %04x %x", got.Opcode, got.Payload, want.Opcode, want.Payload)
		}
	}
}
