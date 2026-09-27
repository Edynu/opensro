package domain

// PKRecord is the durable criminal record. Event teams and equipment-derived
// free-battle groups are deliberately separate identities. Mutations belong in
// the same character-store transaction as the combat consequence that caused
// them; serializers only read the record.
type PKRecord struct {
	DailyCount uint8  `json:"dailyCount"`
	TotalCount uint16 `json:"totalCount"`
	Penalty    uint32 `json:"penalty"`
}

// PVPState is CICUser+4F4. The aggression list is transient; a durable penalty
// takes priority on entry (research server 4E11CD..4E11E0).
func (c *Character) PVPState() uint8 {
	if c == nil {
		return 0
	}
	if c.PK != nil && c.PK.Penalty != 0 {
		return 2
	}
	if len(c.Aggressions) != 0 {
		return 1
	}
	return 0
}

// EventMembership is a projection of an event owner's enrolled participant.
// It is runtime-only: a restart must not recreate an event from a character's
// saved color or a default numeric team. ID zero is never an active event.
type EventMembership struct {
	ID   uint32
	Team uint8
}

func (c *Character) EventTeam() uint8 {
	if c == nil || c.EventMembership == nil || c.EventMembership.ID == 0 {
		return 0xff
	}
	return c.EventMembership.Team
}
