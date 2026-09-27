package domain

// GuildRecord is one persisted guild row: the guild-level half of the
// client's 0x32C4 guild-info block (fold sub_826610). Field widths mirror
// the pinned wire layout - u8 level, u32 GP, u32 crest parameter, the
// unpinned u8 at +0x10 carried verbatim as Byte10.
//
// Guilds deliberately do NOT live on any Character record: a guild is a
// cross-character entity, so it persists in the authority store's guilds /
// guild_members tables (the memos-table pattern), reached through the
// GuildStore door below. Character.GuildID is the FK pointing here.
type GuildRecord struct {
	ID             int64  `json:"id"`
	Name           string `json:"name"`
	Level          uint8  `json:"level"`
	GP             uint32 `json:"gp"`
	NoticeSubject  string `json:"noticeSubject"`
	NoticeContents string `json:"noticeContents"`
	CrestParam     uint32 `json:"crestParam"`
	Byte10         uint8  `json:"byte10"`
}

// GuildMemberRecord is one guild membership row plus the read-model fields
// needed by the 0x32C4 block. CharID is the store character id (the same
// per-division watermark id every other lane keys by); JID is the wire member
// id the client folds.
//
// Level is a character-owned projection and is deliberately excluded from
// persistence. The authority store derives it from the current Character
// while it owns the read or write lock. Persisting a second mutable level in
// the guild row would let the guild roster rot after character progression.
// The offline flag is likewise derived from live session presence at encode
// time.
type GuildMemberRecord struct {
	CharID       int64  `json:"charId"`
	JID          uint32 `json:"jid"`
	Name         string `json:"name"`
	Grade        uint8  `json:"grade"`
	Level        uint8  `json:"-"`
	DonatedGP    uint32 `json:"donatedGp"`
	PermMask     uint32 `json:"permMask"`
	Dword30      uint32 `json:"dword30"`
	Dword34      uint32 `json:"dword34"`
	Dword38      uint32 `json:"dword38"`
	GrantName    string `json:"grantName"`
	RefObjID     uint32 `json:"refObjId"`
	FortressRole uint8  `json:"fortressRole"`
}

// GuildAuthorization describes the actor policy a guild command must satisfy
// while the authority store owns the aggregate.
type GuildAuthorization struct {
	RequiredPermission uint32
	LeaderOnly         bool
}

// GuildSnapshot is a coherent copy of a committed guild aggregate.
type GuildSnapshot struct {
	Guild   GuildRecord
	Members []GuildMemberRecord
}

// GuildRemovalResult carries the pre-removal audience and the member that
// left. The wire layer needs both to publish the resulting delta.
type GuildRemovalResult struct {
	Guild         GuildRecord
	RemovedMember GuildMemberRecord
	MembersBefore []GuildMemberRecord
}

// GuildDonationResult is the committed snapshot plus the donor's updated row.
type GuildDonationResult struct {
	Snapshot GuildSnapshot
	Donor    GuildMemberRecord
}

// GuildRefusal is the closed reason a guild command made no change.
//
// Authorization belongs inside the aggregate lock, but protocol handlers
// still need to distinguish an ordinary player refusal from corrupt stored
// ownership. Returning this domain value preserves both properties without
// leaking wire text or store implementation details across the boundary.
type GuildRefusal uint8

const (
	GuildRefusalNone GuildRefusal = iota
	GuildRefusalActorNotFound
	GuildRefusalDeletePending
	GuildRefusalNotMember
	GuildRefusalInconsistentMembership
	GuildRefusalPermissionDenied
	GuildRefusalLeaderRequired
	GuildRefusalUpdateRejected
	GuildRefusalGuildChanged
	GuildRefusalInvalidMember
	GuildRefusalRosterFull
	GuildRefusalAlreadyMember
	GuildRefusalTargetNotFound
	GuildRefusalSelfTarget
	GuildRefusalTargetLeader
	GuildRefusalLeaderCannotLeave
	GuildRefusalInvalidAmount
	GuildRefusalInsufficientPoints
	GuildRefusalNumericOverflow
)

// Refused reports whether a command made no change.
func (refusal GuildRefusal) Refused() bool {
	return refusal != GuildRefusalNone
}

// GuildStore is the authority store's guild door (the guilds/guild_members
// tables' twin of LetterStore). The dirty unit is the WHOLE guild - the row
// plus its member set - committed as one whole-set replace, and the member
// SLICE ORDER is the wire order the 0x32C4 member loop emits.
type GuildStore interface {
	// Guild returns copies of the guild row and its member list in wire
	// order; ok=false when no such guild is stored.
	Guild(divisionID string, guildID int64) (GuildRecord, []GuildMemberRecord, bool)
	// GuildOfCharacter answers the guild a character is a MEMBER of
	// (resolved from the stored member sets, not from the character
	// record's FK); ok=false when the character belongs to none.
	GuildOfCharacter(divisionID string, characterID int64) (int64, bool)
	// UpdateGuildAs edits metadata or existing member fields. Actor
	// membership, lifecycle, FK coherence, and authorization are checked
	// under the same lock as the callback and commit. The callback cannot
	// change roster topology and must explicitly report a change.
	UpdateGuildAs(
		divisionID string,
		actorID int64,
		label string,
		authorization GuildAuthorization,
		update func(guild GuildRecord, members []GuildMemberRecord) (GuildRecord, []GuildMemberRecord, bool),
	) (GuildSnapshot, GuildRefusal)
	// CreateGuild is the ATOMIC creation door: allocate the division's
	// next guild id (watermark, never reused), install the guild row and
	// the leader's member row, and set leaderCharacter.GuildID - all in
	// ONE commit (two sequential doors would tear guild-vs-FK state on a
	// crash between them). The record's ID field is overwritten with the
	// allocated id, which is also returned. The error is for VALIDATION
	// only (case-insensitive name conflict, live non-pending grade-0
	// leader, and no existing membership); write failures follow the
	// door's fail-open rule.
	CreateGuild(divisionID string, guild GuildRecord, leader GuildMemberRecord, leaderCharacter *Character) (int64, error)
	// AddGuildMemberAs atomically revalidates the inviter's current
	// membership and permission in expectedGuildID, appends the member
	// row, and sets the joining character's GuildID FK.
	AddGuildMemberAs(
		divisionID string,
		expectedGuildID int64,
		actorID int64,
		requiredPermission uint32,
		member GuildMemberRecord,
	) (GuildSnapshot, GuildRefusal)
	// KickGuildMember atomically authorizes the actor, resolves the target
	// by exact member name, removes the non-leader target, and clears the
	// target character's GuildID FK.
	KickGuildMember(
		divisionID string,
		actorID int64,
		targetName string,
		requiredPermission uint32,
	) (GuildRemovalResult, GuildRefusal)
	// LeaveGuild atomically removes the acting non-leader and clears their
	// GuildID FK.
	LeaveGuild(divisionID string, actorID int64) (GuildRemovalResult, GuildRefusal)
	// DissolveGuildAs atomically requires the acting leader, deletes the
	// guild and member set, and clears every member character's GuildID FK.
	DissolveGuildAs(divisionID string, actorID int64) (GuildSnapshot, GuildRefusal)
	// DonateGuildPoints is the ATOMIC guild-point donation door (the
	// 0x740F GP-donate job): debit the donating character's SP, credit
	// the guild's GP and the donor's member-row DonatedGP in ONE
	// commit. Every precondition re-validates under the store lock
	// (guild stored, member row present, character known, 1 <= amount
	// <= the character's SP, no u32 wrap). Returns the new guild GP and
	// the donor's new DonatedGP. A non-zero refusal means no mutation and
	// no commit.
	DonateGuildPoints(divisionID string, characterID int64, amount uint32) (GuildDonationResult, GuildRefusal)
}
