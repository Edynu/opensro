// Package siege is the fortress-war lane of the v1.150 gateway: the S->C
// 0x3887 fortress-war state broadcast whose byte layout is pinned from the
// v1.150 client handler sub_76c870 (CNetProcessSecond OnPacket 0x3887,
// FortressWar).
//
// 0x3887 (native handler sub_76c870, registered on the CNetProcessSecond
// connection by sub_76e850) is the ONLY writer of the client's "war
// active" map at g_refObjDataManager+0x4f4 (two-writer xref proof). This
// lane composes the three gate-critical subtypes:
//
//	subtype 0 - the war-list seed (per-war rows + globalFlags +
//	            fortressListId -> FortressMgr+0x138+0x14 @0x76cb6d);
//	subtype 2 - WAR_BEGIN: bit0 SIEGE_WAR set on every war node
//	            (sub_7e2100(mgr,1,1) @0x76cd98); no payload;
//	subtype 6 - WAR_END: bit0 cleared (@0x76d227); no payload.
//
// The lane registers NO C->S handler and is INERT unless the operator
// enables it (register.go, the MISSION_SPAWN_MONSTERS env idiom): retail
// war scheduling is unpinned, so nothing here runs by default.
package siege

import (
	"opensro.online/server/internal/game/item/wire"
)

// OpFortressWarState is the S->C fortress-war status broadcast, handled
// by the client's sub_76c870 (opcode 0x3887 in the sub_76e850 table).
const OpFortressWarState uint16 = 0x3887

// Subtype bytes of the gate-critical arms (sub_76c870's switch; the
// full 0x00-0x34 domain is in the RE note - 0x13-0x30 are a proven
// client no-op).
const (
	// SubtypeWarList: the full fortress-list refresh (case 0).
	SubtypeWarList uint8 = 0
	// SubtypeWarBegin: bit0 SIEGE_WAR set across the war map (case 2).
	SubtypeWarBegin uint8 = 2
	// SubtypeWarEnd: bit0 cleared across the war map (case 6).
	SubtypeWarEnd uint8 = 6
	// SubtypeWarGuildRegistry: the FortressMgr+0x2f4 war-fortress
	// registry clear-and-replace (case 0x10) - the GetStatus 0xc9/0xca
	// membership input (sub_81c1c0 clear @0x76e3fd + sub_829580 insert
	// @0x76e43f; session-3 RE).
	SubtypeWarGuildRegistry uint8 = 0x10
)

// OpSiegeRelationList is the S->C 0x341E bulk siege-relation/alliance
// list, handled by the client's sub_75ab60 (registration @0x74ea1a) ->
// sub_82a560, whose per-entry sub_828c10 insert fills the relation
// block's +0x94 map - the GetStatus 0xcb "ally" leg input.
const OpSiegeRelationList uint16 = 0x341e

// Global-flags bits of the subtype-0 trailing byte (the client case-0
// [Debug] table @0x76cb16..0x76cb53); the byte is OR-ed into EVERY war
// node via sub_7e2100 @0x76cae7.
const (
	// WarFlagSiegeWar is bit0 - the "war active" bit sub_7e1ae0 reads.
	WarFlagSiegeWar uint8 = 0x1
	// WarFlagRequestPeriod is bit1 (SIEGE_REQUEST_ALLOWED_PERIOD).
	WarFlagRequestPeriod uint8 = 0x2
	// WarFlagTaxPeriod is bit2 (SIEGE_TAX_ALLOWED_PERIOD).
	WarFlagTaxPeriod uint8 = 0x4
)

// WarRow is one subtype-0 record in the client's proven read order
// (sub_76c870 @0x76c960..0x76ca2b): u32 warId, sized string name, four
// u32 stats, u8 hasA [+u32 A], u8 hasB [+u32 B].
//
// The four stats and the two optional u32s are read by the client to
// keep the stream aligned and stored opaquely (+0x524/+0x530) - their
// server-side MEANING IS UNPROVEN, so this composer carries them as
// unnamed values and invents nothing.
type WarRow struct {
	WarID uint32
	// Name lands in the client's +0x4e8 war-name map (its wstring is
	// read by sub_4b1710: u16 length + length BYTES - a NARROW payload,
	// NOT UTF-16).
	Name string
	// Stats are the four u32s @0x76c980..0x76c9b3 (meaning unproven).
	Stats [4]uint32
	// HasA/A: the first optional u32 (client +0x524; meaning unproven).
	HasA bool
	A    uint32
	// HasB/B: the second optional u32 (client +0x530; meaning unproven).
	HasB bool
	B    uint32
}

// EncodeWarList3887 renders the subtype-0 body: u8 0, u8 N, N rows in
// the proven order, u8 globalFlags, u32 fortressListId. For a war to be
// active without a follow-up SubtypeWarBegin frame, set WarFlagSiegeWar
// in globalFlags (the client's per-row upsert flags byte is its own
// CONSTANT 0 @0x76ca33 - activation only rides globalFlags or subtype 2).
func EncodeWarList3887(rows []WarRow, globalFlags uint8, fortressListID uint32) []byte {
	writer := wire.NewWriter(7 + len(rows)*32)
	writer.U8(SubtypeWarList)
	writer.U8(uint8(len(rows)))
	for _, row := range rows {
		writer.U32(row.WarID)
		writeSizedString(writer, row.Name)
		for _, stat := range row.Stats {
			writer.U32(stat)
		}
		if row.HasA {
			writer.U8(1).U32(row.A)
		} else {
			writer.U8(0)
		}
		if row.HasB {
			writer.U8(1).U32(row.B)
		} else {
			writer.U8(0)
		}
	}
	writer.U8(globalFlags)
	writer.U32(fortressListID)
	return writer.Payload()
}

// EncodeWarGuildRegistry3887 renders the subtype-0x10 body: u8 0x10,
// u32 echo (the client parses then discards it @0x76e3e5 - the other
// subtypes' "mgrPtr" convention), u8 N, N x u32 guildId. The client
// CLEARS its FortressMgr+0x2f4 set before the loop (clear-and-replace,
// no single-erase path exists), skips id 0 at the loop guard @0x76e424
// AND inside the sub_829580 insert @0x829588, and unique-inserts the
// rest. IDs are guild IDs, proven by 828150 reading SGuildData+30.
func EncodeWarGuildRegistry3887(echo uint32, guildIDs []uint32) []byte {
	writer := wire.NewWriter(6 + len(guildIDs)*4)
	writer.U8(SubtypeWarGuildRegistry)
	writer.U32(echo)
	writer.U8(uint8(len(guildIDs)))
	for _, id := range guildIDs {
		writer.U32(id)
	}
	return writer.Payload()
}

// AllianceRow is one 0x341E siege-relation entry in the client's proven
// read order (sub_82a560 @0x82a63b..0x82a700). ID is the +0x94 map KEY:
// 828150 and 826D40 compare target GUILD IDs, including on the war path.
type AllianceRow struct {
	ID uint32
	// Name lands in the node's +0x04 wstring (narrow sized string) and
	// feeds the per-entry sub_833d40 crest label update.
	Name string
	// Flag is the u8 the insert stores at node+0x20 (the guild level on
	// the alliance path; semantics unnamed on the war path).
	Flag uint8
	// MasterName lands in the node's +0x24 wstring.
	MasterName string
	// RefObjID lands at node+0x40 (the master's model ref).
	RefObjID uint32
	// Byte44 lands at node+0x44 (semantics unnamed).
	Byte44 uint8
}

// EncodeSiegeRelationList341E renders the 0x341E body per the pinned
// read order: u32 -> FortressMgr+0x238, u32 -> +0x234 (both semantics
// unnamed - re-read by the per-entry crest label call), u32 alliance
// MASTER guild id (sub_8188d0 -> +0x230), u8 N, then N rows
// { u32 id, str name, u8 flag, str masterName, u32 refObjId, u8 byte }.
// NOTE: the client's sub_828c10 insert ASSERTS on a duplicate id
// ("!IsAllianceGuild(dwGuildID)") - a reseed must follow a 0x32C4 (whose
// handler resets the relation block) or carry disjoint ids.
func EncodeSiegeRelationList341E(dword238, dword234, masterGuildID uint32, rows []AllianceRow) []byte {
	writer := wire.NewWriter(13 + len(rows)*16)
	writer.U32(dword238)
	writer.U32(dword234)
	writer.U32(masterGuildID)
	writer.U8(uint8(len(rows)))
	for _, row := range rows {
		writer.U32(row.ID)
		writeSizedString(writer, row.Name)
		writer.U8(row.Flag)
		writeSizedString(writer, row.MasterName)
		writer.U32(row.RefObjID)
		writer.U8(row.Byte44)
	}
	return writer.Payload()
}

// EncodeWarBegin3887 renders the subtype-2 WAR_BEGIN frame: the u8
// subtype alone (the client case reads nothing further).
func EncodeWarBegin3887() []byte {
	return []byte{SubtypeWarBegin}
}

// EncodeWarEnd3887 renders the subtype-6 WAR_END frame: the u8 subtype
// alone.
func EncodeWarEnd3887() []byte {
	return []byte{SubtypeWarEnd}
}

// writeSizedString appends the sub_4b1710 sized layout: u16 byte length
// + the bytes. The client reads exactly `length` BYTES into its wstring
// storage (one code unit per byte) - this is NOT the sub_75d8a0
// UTF-16LE layout the match lane writes.
func writeSizedString(writer *wire.Writer, value string) {
	bytes := []byte(value)
	writer.U16(uint16(len(bytes)))
	writer.Bytes(bytes)
}
