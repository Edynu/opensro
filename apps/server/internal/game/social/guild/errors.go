package guild

// v1.150 client 75F9B0/75C950 decodes result 2 and one error byte.
// The later research server uses u16 4Cxx errors; only the verified low-byte
// semantic contract is adapted here, never that later packet width.
const (
	// 5C64B9: missing guild; native v1.150 category 10:0D is silent.
	GuildErrNotMember byte = 0x0D
	// 5C64DF after 5D0F80 checks permission mask 10; 68A88C localizes.
	GuildErrPermissionDenied byte = 0x1E
	// Existing create-length contract: 5C5FB4 covers empty names.
	GuildErrInvalidGuildNameLen byte = 0x18
	// 5C64ED/5C6547 and 5C64FB/5C653B; v1.150 68A8A0/68A8AA.
	GuildErrInvalidMasterCommentTitle byte = 0x22
	GuildErrInvalidMasterComment      byte = 0x23
)

// The category is supplied by the client opcode handler, not on the wire.
// Wider per-opcode branches (e.g. B663/3C) require their own encoder.
func EncodeGuildErrorResult(code byte) []byte { return []byte{2, code} }

// Not established by these constants: create duplicate/name-policy/database
// triggers, other guild mutators, direct/local dialogs and missing carriers.
// Notice client limits (127/1023) differ from the later server (128/2048).
// Do not reuse its out-of-range codes for those narrower limits without evidence.
