package guild_test

// End-to-end exercise of guild LEAVE (0x756E) over the REAL transport
// against the REAL authority store, on the e2e_guild_wire_test.go
// composition helpers:
//
//	E creates    -> a SYNTHETIC 0x7663 founds the guild over the wire
//	                (E is the grade-0 leader);
//	F seeded in  -> membership installed through the store doors with a
//	                jid distinct from uint32(id);
//	F leaves     -> with BOTH members online, F's 0x756E answers 0xB56E
//	                {01} to F ONLY, then fans ONE 0x3B29 subOp-3 KIND-1
//	                frame to both live members - the leaver included
//	                (their client's jid==me arm does the full reset);
//	F relogs     -> NO 0x32C4 rides F's seeds (FK cleared by the atomic
//	                door), proven by F's next elicited frame being the
//	                0xB663 answer to a fresh create - which also pins
//	                the watermark at id 2.

import (
	"bytes"
	"encoding/binary"
	"path/filepath"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/social/guild"
	"opensro.online/server/internal/transport"
)

const (
	guildLeaveE2ENameE = "e2eGldEcho"
	guildLeaveE2ENameF = "e2eGldFox"
	guildLeaveE2EJIDF  = uint32(650000) // + the store id; distinct from uint32(id) to pin the STORED jid
)

func leaveE2EPayload(selectedTargetGid uint32) []byte {
	buf := &bytes.Buffer{}
	binary.Write(buf, binary.LittleEndian, selectedTargetGid)
	return buf.Bytes()
}

func TestGuildLeaveEndToEndOverWire(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")

	race := func() *int64 { v := enterworld.RaceChina; return &v }
	gender := func() *int64 { v := enterworld.GenderMale; return &v }
	seeds := []*enterworld.Character{
		{Name: guildLeaveE2ENameE, ModelCodename: "CHAR_CH_MAN_ADVENTURER", RaceIndex: race(), Gender: gender()},
		{Name: guildLeaveE2ENameF, ModelCodename: "CHAR_CH_MAN_ADVENTURER", RaceIndex: race(), Gender: gender()},
	}
	server := startGuildServer(t, dir, seeds)
	echo := guildE2ECharacter(t, server.authority, guildLeaveE2ENameE)
	fox := guildE2ECharacter(t, server.authority, guildLeaveE2ENameF)

	// ---- E enters guildless and founds the guild over the wire ----
	connEcho := guildDialWS(t, server.srv)
	guildHelloWS(t, connEcho)
	guildEnterWorldSeeds(t, connEcho, guildLeaveE2ENameE)
	guildSendFrame(t, connEcho, guild.OpGuildCreateRequest, mutE2ECreatePayload(0, "LeaveBanner"))
	ack := guildExpectFrame(t, connEcho, guild.OpGuildCreateAck, "create ack")
	wantAck := append([]byte{0x01}, mutE2EBlockOracle(1, "LeaveBanner", []mutE2EMember{
		{jid: uint32(echo.ID), name: guildLeaveE2ENameE, grade: 0, perm: 0xffffffff, offline: 0},
	})...)
	if !bytes.Equal(ack, wantAck) {
		t.Fatalf("0xB663 = % X, want the oracle % X", ack, wantAck)
	}

	// ---- seed F into the guild through the store doors ----
	const guildID = int64(1)
	foxJID := guildLeaveE2EJIDF + uint32(fox.ID)
	if !addGuildMemberForTest(server.authority.Guilds(), guildE2EDivision, guildID, echo.ID, enterworld.GuildMemberRecord{
		CharID: fox.ID, JID: foxJID, Name: guildLeaveE2ENameF, Grade: 3, Level: 1, RefObjID: 1907,
	}) {
		t.Fatal("fixture member join refused")
	}

	// ---- F enters ONLINE, then leaves: both members observe frames ----
	connFox := guildDialWS(t, server.srv)
	guildHelloWS(t, connFox)
	foxSeed := guildEnterWorld(t, connFox, guildLeaveE2ENameF)
	wantFoxSeed := mutE2EBlockOracle(1, "LeaveBanner", []mutE2EMember{
		{jid: uint32(echo.ID), name: guildLeaveE2ENameE, grade: 0, perm: 0xffffffff, offline: 0},
		{jid: foxJID, name: guildLeaveE2ENameF, grade: 3, perm: 0, offline: 1},
	})
	if !bytes.Equal(foxSeed, wantFoxSeed) {
		t.Fatalf("F's 0x32C4 = % X, want the two-member guild % X", foxSeed, wantFoxSeed)
	}

	guildSendFrame(t, connFox, guild.OpGuildLeaveRequest, leaveE2EPayload(0))
	// The actor's ack lands FIRST (the handler sends it before the
	// fan-out): exactly {01} - result=2 is never composed.
	if got := guildExpectFrame(t, connFox, guild.OpGuildLeaveAck, "leaver's 0xB56E"); !bytes.Equal(got, []byte{0x01}) {
		t.Fatalf("leaver's 0xB56E = % X, want [01]", got)
	}
	// ONE subOp-3 KIND-1 frame serves both live members - the leaver
	// included: their client's jid==me arm performs the full guild
	// reset the ack alone does not.
	wantLeave := []byte{0x03, byte(foxJID), byte(foxJID >> 8), byte(foxJID >> 16), byte(foxJID >> 24), 0x01}
	if got := guildExpectFrame(t, connFox, guild.OpGuildUpdatePush, "leaver's subOp 3"); !bytes.Equal(got, wantLeave) {
		t.Fatalf("leaver's 0x3B29 = % X, want % X", got, wantLeave)
	}
	if got := guildExpectFrame(t, connEcho, guild.OpGuildUpdatePush, "leader's subOp 3"); !bytes.Equal(got, wantLeave) {
		t.Fatalf("leader's 0x3B29 = % X, want the SAME frame % X", got, wantLeave)
	}
	guildSendFrame(t, connFox, transport.OpBye, []byte{transport.ByeReasonNormal})
	connFox.Close()

	// ---- F relogs: NO 0x32C4, and a fresh create answers as guild 2 ----
	connFox2 := guildDialWS(t, server.srv)
	guildHelloWS(t, connFox2)
	guildEnterWorldSeeds(t, connFox2, guildLeaveE2ENameF)
	guildSendFrame(t, connFox2, guild.OpGuildCreateRequest, mutE2ECreatePayload(0, "FoxBanner"))
	// The very NEXT frame is the create ack: no 0x32C4 rode the seeds
	// (guildExpectFrame fails loud on any other opcode), the leaver's
	// FK is clear (a linked character's create refuses), and the
	// watermark allocates 2 - id 1 is never reissued.
	ack2 := guildExpectFrame(t, connFox2, guild.OpGuildCreateAck, "post-leave create ack")
	wantAck2 := append([]byte{0x01}, mutE2EBlockOracle(2, "FoxBanner", []mutE2EMember{
		{jid: uint32(fox.ID), name: guildLeaveE2ENameF, grade: 0, perm: 0xffffffff, offline: 0},
	})...)
	if !bytes.Equal(ack2, wantAck2) {
		t.Fatalf("post-leave 0xB663 = % X, want the oracle % X", ack2, wantAck2)
	}

	if dropped := server.srv.Hub.Metrics().RateLimitedFrames; dropped != 0 {
		t.Fatalf("rate limiter clamped %d frame(s)", dropped)
	}
	guildSendFrame(t, connEcho, transport.OpBye, []byte{transport.ByeReasonNormal})
	guildSendFrame(t, connFox2, transport.OpBye, []byte{transport.ByeReasonNormal})
}
