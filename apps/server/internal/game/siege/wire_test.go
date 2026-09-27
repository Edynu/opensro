package siege

// The 0x3887 byte-layout pins: every frame is compared against a
// hand-rolled oracle built with encoding/binary here, NEVER the
// production encoder - the encoder must match the pinned sub_76c870
// read order, not itself. That layout is the
// contract with the client parser.

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestRegistryUsesExplicitGuildIDsNeverWarIDs(t *testing.T) {
	t.Setenv(SeedEnvVar, "99:TEST_WAR")
	t.Setenv(GuildsEnvVar, "")
	t.Setenv(AlliesEnvVar, "")
	rt, err := NewRuntimeFromEnv(nil)
	if err != nil || len(rt.guildIDs) != 0 {
		t.Fatalf("implicit guild from war ID: %v %v", rt, err)
	}
	t.Setenv(GuildsEnvVar, "1001,2002")
	rt, err = NewRuntimeFromEnv(nil)
	if err != nil || len(rt.guildIDs) != 2 || rt.guildIDs[0] != 1001 || rt.guildIDs[1] != 2002 {
		t.Fatalf("guild registry: %v %v", rt, err)
	}
}

// oracleU32 renders one little-endian u32.
func oracleU32(v uint32) []byte {
	out := make([]byte, 4)
	binary.LittleEndian.PutUint32(out, v)
	return out
}

// oracleSizedString renders the sub_4b1710 layout: u16 byte length +
// the bytes (NARROW - the client reads exactly `length` bytes into its
// wstring storage, one code unit per byte; not UTF-16LE).
func oracleSizedString(s string) []byte {
	out := make([]byte, 2)
	binary.LittleEndian.PutUint16(out, uint16(len(s)))
	return append(out, []byte(s)...)
}

func concat(chunks ...[]byte) []byte {
	var out []byte
	for _, chunk := range chunks {
		out = append(out, chunk...)
	}
	return out
}

func TestEncodeWarList3887MatchesThePinnedSubtype0Layout(t *testing.T) {
	got := EncodeWarList3887(
		[]WarRow{
			{
				WarID: 501,
				Name:  "AWar",
				Stats: [4]uint32{11, 22, 33, 44},
				HasA:  true,
				A:     7777,
			},
			{
				WarID: 502,
				Name:  "BWarX",
				Stats: [4]uint32{1, 2, 3, 4},
				HasB:  true,
				B:     8888,
			},
		},
		WarFlagSiegeWar,
		0x00c81234,
	)

	// sub_76c870 case 0 read order: u8 subtype, u8 N, per row
	// { u32 id @0x76c960, sized name @0x76c96f, u32 x4 @0x76c980..,
	//   u8 hasA @0x76c9c1 [+u32 @0x76c9ff], u8 hasB @0x76ca11
	//   [+u32 @0x76ca26] }, u8 globalFlags @0x76cad6,
	// u32 fortressListId @0x76caf5.
	want := concat(
		[]byte{0x00, 0x02},
		oracleU32(501), oracleSizedString("AWar"),
		oracleU32(11), oracleU32(22), oracleU32(33), oracleU32(44),
		[]byte{0x01}, oracleU32(7777),
		[]byte{0x00},
		oracleU32(502), oracleSizedString("BWarX"),
		oracleU32(1), oracleU32(2), oracleU32(3), oracleU32(4),
		[]byte{0x00},
		[]byte{0x01}, oracleU32(8888),
		[]byte{0x01},
		oracleU32(0x00c81234),
	)
	if !bytes.Equal(got, want) {
		t.Fatalf("subtype-0 layout mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestEncodeWarList3887EmptyListStillCarriesTheTail(t *testing.T) {
	// N=0 short-circuits the client's row loop (@0x76c914) but the
	// trailing globalFlags + fortressListId reads still run
	// (@0x76cad6/@0x76caf5) - the tail must always be present.
	got := EncodeWarList3887(nil, 0, 7)
	want := concat([]byte{0x00, 0x00, 0x00}, oracleU32(7))
	if !bytes.Equal(got, want) {
		t.Fatalf("empty-list layout mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestEncodeWarGuildRegistry3887MatchesThePinnedSubtype0x10Layout(t *testing.T) {
	got := EncodeWarGuildRegistry3887(0xdeadbeef, []uint32{1, 3, 501})

	// sub_76c870 case 0x10 read order: u8 subtype @0x76e3cc dispatch,
	// u32 echo @0x76e3e5 (parsed, discarded), u8 N @0x76e3f3, then N x
	// u32 fortressId @0x76e419 (clear @0x76e3fd runs BEFORE the loop -
	// clear-and-replace, so the frame carries the COMPLETE registry).
	want := concat(
		[]byte{0x10},
		oracleU32(0xdeadbeef),
		[]byte{0x03},
		oracleU32(1), oracleU32(3), oracleU32(501),
	)
	if !bytes.Equal(got, want) {
		t.Fatalf("subtype-0x10 layout mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestEncodeWarGuildRegistry3887EmptyListStillClears(t *testing.T) {
	// N=0 is a valid frame: the client still runs the sub_81c1c0 clear
	// @0x76e3fd, emptying the registry (marks 0xc9/0xca off).
	got := EncodeWarGuildRegistry3887(0, nil)
	want := concat([]byte{0x10}, oracleU32(0), []byte{0x00})
	if !bytes.Equal(got, want) {
		t.Fatalf("empty registry layout mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestEncodeSiegeRelationList341EMatchesThePinnedLayout(t *testing.T) {
	got := EncodeSiegeRelationList341E(0x11, 0x22, 0x2001, []AllianceRow{
		{ID: 9, Name: "AllyFort", Flag: 2, MasterName: "Lord", RefObjID: 1907, Byte44: 1},
		{ID: 12, Name: "BFort"},
	})

	// sub_82a560 read order: u32 -> mgr+0x238 @0x82a5af, u32 -> mgr+0x234
	// @0x82a5bf, u32 -> sub_8188d0 (mgr+0x230) @0x82a5cd/@0x82a5e7,
	// u8 count @0x82a5db, then per row { u32 id @0x82a63b, sized name
	// @0x82a649.., u8 flag @0x82a698, sized masterName @0x82a6a6..,
	// u32 refObjId @0x82a6f2, u8 byte44 @0x82a700 } -> sub_828c10 insert
	// @0x82a758 (the relation block +0x94, the GetStatus 0xcb leg).
	want := concat(
		oracleU32(0x11), oracleU32(0x22), oracleU32(0x2001),
		[]byte{0x02},
		oracleU32(9), oracleSizedString("AllyFort"),
		[]byte{0x02}, oracleSizedString("Lord"),
		oracleU32(1907), []byte{0x01},
		oracleU32(12), oracleSizedString("BFort"),
		[]byte{0x00}, oracleSizedString(""),
		oracleU32(0), []byte{0x00},
	)
	if !bytes.Equal(got, want) {
		t.Fatalf("0x341e layout mismatch:\n got %x\nwant %x", got, want)
	}
}

func TestParseFortressAndAllySpecs(t *testing.T) {
	ids, err := parseGuildSpec("1, 3,501")
	if err != nil {
		t.Fatalf("valid fortress spec refused: %v", err)
	}
	if len(ids) != 3 || ids[0] != 1 || ids[1] != 3 || ids[2] != 501 {
		t.Fatalf("parsed fortress ids wrong: %+v", ids)
	}
	for _, bad := range []string{"x", "0", "1,,3"} {
		if _, err := parseGuildSpec(bad); err == nil {
			t.Fatalf("malformed fortress spec %q accepted", bad)
		}
	}

	rows, err := parseAllySpec("9:AllyFort, 12:BFort")
	if err != nil {
		t.Fatalf("valid ally spec refused: %v", err)
	}
	if len(rows) != 2 || rows[0].ID != 9 || rows[0].Name != "AllyFort" ||
		rows[1].ID != 12 || rows[1].Name != "BFort" {
		t.Fatalf("parsed ally rows wrong: %+v", rows)
	}
	for _, bad := range []string{"nocolon", "5:", "x:Name"} {
		if _, err := parseAllySpec(bad); err == nil {
			t.Fatalf("malformed ally spec %q accepted", bad)
		}
	}
}

func TestEncodeWarBeginAndEndAreTheBareSubtypeBytes(t *testing.T) {
	// Cases 2 and 6 read NOTHING beyond the subtype byte.
	if got := EncodeWarBegin3887(); !bytes.Equal(got, []byte{0x02}) {
		t.Fatalf("WAR_BEGIN frame: got %x, want 02", got)
	}
	if got := EncodeWarEnd3887(); !bytes.Equal(got, []byte{0x06}) {
		t.Fatalf("WAR_END frame: got %x, want 06", got)
	}
}

func TestParseSeedSpecRowsAndRefusals(t *testing.T) {
	rows, err := parseSeedSpec("1:JanganWar, 3:HotanWar")
	if err != nil {
		t.Fatalf("valid spec refused: %v", err)
	}
	if len(rows) != 2 || rows[0].WarID != 1 || rows[0].Name != "JanganWar" ||
		rows[1].WarID != 3 || rows[1].Name != "HotanWar" {
		t.Fatalf("parsed rows wrong: %+v", rows)
	}
	for _, bad := range []string{"nocolon", "5:", "x:Name"} {
		if _, err := parseSeedSpec(bad); err == nil {
			t.Fatalf("malformed spec %q accepted", bad)
		}
	}
}
