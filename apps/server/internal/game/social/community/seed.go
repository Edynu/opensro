package community

import (
	"opensro.online/server/internal/game/enterworld"
)

// SeedFramesFunc returns the community-window seed builder every
// successful enter-world pushes after the bootstrap packet sequence: the
// friend roster push (0x3769) encoded from the character's PERSISTED
// friend edges with each state byte derived from LIVE presence at encode
// time (never persisted - a nil presence honestly reads all-offline),
// and the letter list answer (0xB3CD) encoded from the character's
// PERSISTED mailbox (the authority store's memos table; a nil letter
// store honestly reads empty). The whisper-block list deliberately does
// NOT ride here: its pinned channel is chunk C of the entered stream,
// mid-0x32B3 (enterworld.BuildLocalPlayerEntryPayload).
//
// Relative order friend-then-letter is POLICY (no native pin on the
// inter-frame ordering exists; each fold is self-contained). The
// character argument is the snapshot copy the enter-world glue holds;
// divisionID scopes the presence, mailbox and guild lookups (store
// character IDs are per-division watermarks, so a division-less view
// would be ambiguous). Assigned onto the shared
// deps.CommunitySeedFramesFor before gameplay starts.
func SeedFramesFunc(presence Presence, letters enterworld.LetterStore) func(divisionID string, character *enterworld.Character) []enterworld.Packet {
	return func(divisionID string, character *enterworld.Character) []enterworld.Packet {
		var mailbox []enterworld.LetterRecord
		if letters != nil && character != nil {
			mailbox = letters.Mailbox(divisionID, character.ID)
		}
		return []enterworld.Packet{
			enterworld.NewPacket(OpFriendRosterPush, EncodeFriendRoster3769(FriendRosterEntries(presence, divisionID, character))),
			enterworld.NewPacket(OpLetterListAnswer, EncodeLetterListB3CD(MailboxListEntries(mailbox))),
		}
	}
}

// SeedFrames is the presence-less, store-less seed builder (tests,
// store-less dev): every friend edge encodes offline, the letter list
// encodes empty, and no guild frame ever rides - exactly what a
// transport-less view can honestly claim.
func SeedFrames(divisionID string, character *enterworld.Character) []enterworld.Packet {
	return SeedFramesFunc(nil, nil)(divisionID, character)
}
