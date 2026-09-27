package guild

// The 0x32C4 guild-info encoder: the S->C block the client's guild
// deserializer (fold sub_826610) reads on receipt, composed ONLY from
// real store membership (enterworld.GuildStore records) - never empty,
// never synthetic (the package doc; the deserializer always sets
// hasGuildFlag04=1, so an empty frame would paint a guild onto a
// guildless character).

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
)

// writeGuildString appends the sized-ANSI layout {u16 byte length, the
// bytes} every 0x32C4 string field carries (the same shape the C->S guild
// bodies decode with readSizedString).
func writeGuildString(w *wire.Writer, value string) {
	raw := []byte(value)
	w.U16(uint16(len(raw)))
	w.Bytes(raw)
}

// EncodeGuildInfo32C4 composes the 0x32C4 body per the pinned client
// layout (fold sub_826610; little-endian, strings are {u16 len}{ANSI}):
//
//	u32 guildId, {str} name, u8 level, u32 GP, {str} noticeSubject,
//	{str} noticeContents, u32 crestParam, u8 byte10, u8 memberCount,
//	per member: u32 jid, {str} name, u8 grade, u8 level, u32 donatedGP,
//	u32 permMask, u32 dword30, u32 dword34, u32 dword38, {str} grantName,
//	u32 refObjId, u8 fortressRole, u8 offlineFlag,
//	then u8 voteCount (always 0 here - votes are out of scope).
//
// The offline flag is DERIVED at encode time (0 = ONLINE, 1 = offline)
// through the online func, never persisted - the friend roster's
// state-byte rule. A nil online func honestly reads everyone offline.
func EncodeGuildInfo32C4(guild enterworld.GuildRecord, members []enterworld.GuildMemberRecord, online func(name string) bool) []byte {
	writer := wire.NewWriter(64 + 64*len(members))
	writeGuildBlock(writer, guild, members, online)
	return writer.Payload()
}

// EncodeCreateAckB663 composes the 0xB663 create-success body: the
// result byte 1 followed by the SAME guild block bytes 0x32C4 carries
// (the client's 0xB663 handler reads the result byte and falls into the
// same sub_826610 block deserializer). Emitted to the creating actor
// ONLY, always from the guild the atomic create door just installed.
func EncodeCreateAckB663(guild enterworld.GuildRecord, members []enterworld.GuildMemberRecord, online func(name string) bool) []byte {
	writer := wire.NewWriter(65 + 64*len(members))
	writer.U8(1)
	writeGuildBlock(writer, guild, members, online)
	return writer.Payload()
}

// writeGuildBlock appends the guild block body shared by 0x32C4 and the
// 0xB663 ack (both frames are opcode + result-byte-or-nothing + these
// exact bytes; the layout doc lives on EncodeGuildInfo32C4).
func writeGuildBlock(writer *wire.Writer, guild enterworld.GuildRecord, members []enterworld.GuildMemberRecord, online func(name string) bool) {
	writer.U32(uint32(guild.ID))
	writeGuildString(writer, guild.Name)
	writer.U8(guild.Level)
	writer.U32(guild.GP)
	writeGuildString(writer, guild.NoticeSubject)
	writeGuildString(writer, guild.NoticeContents)
	writer.U32(guild.CrestParam)
	writer.U8(guild.Byte10)
	writer.U8(uint8(len(members)))
	for _, member := range members {
		writeGuildMemberRow(writer, member, online)
	}
	writer.U8(0)
}

// writeGuildMemberRow appends ONE member row in the pinned 0x32C4
// member-loop order (fold sub_826610). The SAME byte layout is the
// 0x3B29 subOp-2 join body after its subOp byte (fold sub_762040 slot 2
// reads jid @0x0076224e .. offline @0x007622f8 in this exact order, the
// +0x2c dword being the permMask slot), which is why the row writer is
// factored here and shared - one layout, one writer.
func writeGuildMemberRow(writer *wire.Writer, member enterworld.GuildMemberRecord, online func(name string) bool) {
	writer.U32(member.JID)
	writeGuildString(writer, member.Name)
	writer.U8(member.Grade)
	writer.U8(member.Level)
	writer.U32(member.DonatedGP)
	writer.U32(member.PermMask)
	writer.U32(member.Dword30)
	writer.U32(member.Dword34)
	writer.U32(member.Dword38)
	writeGuildString(writer, member.GrantName)
	writer.U32(member.RefObjID)
	writer.U8(member.FortressRole)
	offlineFlag := uint8(1)
	if online != nil && online(member.Name) {
		offlineFlag = 0
	}
	writer.U8(offlineFlag)
}

// EncodeMemberJoin3B29 composes the 0x3B29 subOp-2 member JOIN push the
// client's guild store inserts (fold sub_762040 slot 2 @0x007621c1 ->
// the REAL sub_8261e0 insert): {u8 2} followed by ONE member row in the
// exact 0x32C4 member-loop layout (the row bytes ride the SHARED
// writeGuildMemberRow, never a second derivation). Sent to every
// SITTING online member on a join commit; the joiner gets the full
// 0x32C4 block instead - their client holds no guild entry block for a
// subOp-2 insert to land in.
func EncodeMemberJoin3B29(member enterworld.GuildMemberRecord, online func(name string) bool) []byte {
	writer := wire.NewWriter(41 + len(member.Name) + len(member.GrantName))
	writer.U8(2)
	writeGuildMemberRow(writer, member, online)
	return writer.Payload()
}
