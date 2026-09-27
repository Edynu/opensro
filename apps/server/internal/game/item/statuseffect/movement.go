package statuseffect

// MovementKind selects the mutually exclusive native descriptor branches at
// 59642C..59659E (v1.188 research server). Zero preserves plain hste producers.
type MovementKind uint8

const (
	MovementHaste       MovementKind = iota
	MovementOverride                 // hst2: suspend the slot source; retain it for restoration
	MovementIndependent              // hst3: install a source without touching the slot
)

type movementPhase uint8

const (
	movementUnbound movementPhase = iota
	movementBound
	movementRetired
)

// prepareMovement owns contribution handoff under the registry lock. The port
// commits immediate recasts before its deferred B6A0 drain. Retire predecessor
// contributions here, exactly once, before installing the successor; retaining
// the presentation row must not retain its native parameter source or slot.
// Call only after every admission check has succeeded.
func prepareMovement(rows []Effect, exact int, incoming *Effect) {
	// A diagnostic snapshot is not an authority to import a slot/phase into a
	// new application. Derive those fields again inside this transaction.
	incoming.movementPhase = movementUnbound
	incoming.movementSlot = false
	incoming.movementAuthoredPercent = 0
	for i := range rows {
		if i == exact || incoming.Movement && rows[i].StopRequested {
			retireMovement(rows, i)
		}
	}
	if !incoming.Movement {
		incoming.MovementPercent = 0
		return
	}
	if incoming.MovementPercent == 0 {
		return
	}
	incoming.movementPhase = movementBound
	incoming.movementAuthoredPercent = incoming.MovementPercent
	slot := -1
	for i := range rows {
		if rows[i].movementSlot {
			slot = i
			break
		}
	}
	switch incoming.MovementKind {
	case MovementHaste:
		// 59643A gates installation, but 596497 always assigns the slot.
		if slot >= 0 {
			incoming.MovementPercent = 0
			rows[slot].movementSlot = false
		}
		incoming.movementSlot = true
	case MovementOverride:
		// 5964B3 removes the slot source. 59652F retains a nonempty slot.
		if slot >= 0 {
			rows[slot].MovementPercent = 0
		} else {
			incoming.movementSlot = true
		}
	case MovementIndependent:
		// 596551..596599 never accesses manager+1F4.
	}
}

func retireMovement(rows []Effect, index int) {
	e := &rows[index]
	if e.movementPhase != movementBound {
		return
	}
	switch e.MovementKind {
	case MovementHaste:
		// 582E38 unconditionally clears the haste slot, even when another
		// plain application most recently claimed it without installing.
		for i := range rows {
			rows[i].movementSlot = false
		}
	case MovementOverride:
		for i := range rows {
			if !rows[i].movementSlot {
				continue
			}
			if i == index {
				rows[i].movementSlot = false
			} else if rows[i].MovementKind == MovementHaste && rows[i].movementPhase == movementBound {
				// 582E4F..582ECC restores only the retained plain hste source.
				rows[i].MovementPercent = rows[i].movementAuthoredPercent
			}
			break
		}
	}
	e.MovementPercent = 0
	e.movementSlot = false
	e.movementPhase = movementRetired
}
