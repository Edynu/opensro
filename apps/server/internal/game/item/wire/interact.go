package wire

import "fmt"

// TargetInteract is the client's 0x72CD ground-interact request, the trigger
// for a ground-item pickup.
//
// Wire (bridge serializer @0x698b45, byte-pinned by REV-1):
//
//	interact: [0x01][0x02][0x01][u32le gid]
//	cancel:   [0x02]
//
// 0x72CD is multiplexed: skill/action-use from sub_6fcd50 uses second byte
// 0x04 (see SkillAction). This decoder refuses that family on purpose —
// skill bytes must not grant pickup.
//
// The three lead bytes of the interact form are the world-click CIItem leg's
// discriminators; they are constant on this path and validated as such
// rather than interpreted. The bare 0x02 cancel fires when the player clicks
// away while the approach latch is armed (+0x618 == 1, sub_6932a0); the
// server must treat it as a superseding outcome and release the latch - the
// client can never self-clear it.
//
// sub_693190 does NOT retransmit this interact form: it emits bare [0x02]
// as a throttled cancel/recovery command from manual movement input. A
// duplicate execute can still arrive from another user click and is treated
// idempotently while the server-owned approach remains in flight.
type TargetInteract struct {
	// Cancel is true for the bare [0x02] form; Gid is then meaningless.
	Cancel bool
	// Gid is the ground-item entity id being interacted with.
	Gid uint32
}

// BasicAttackEngage is the native 0x72CD target-engage command. It is the
// server-facing result of both retail ways to request the weapon's base
// attack:
//
//   - world double-click / Ctrl+click (sub_692cb0): [01][01][01][gid]
//   - action-pane attack command (sub_6fcd50):       [01][03][01][gid]
//
// This is an INTENT, not a hit. The authority keeps it alive while the
// actor approaches, attacks at the equipped weapon cadence, or until a
// superseding move/cancel/death invalidates it.
type BasicAttackEngage struct {
	TargetGid uint32
	// ActionPane distinguishes the second native producer. Both forms enter
	// the same authority state machine after their exact wire shape passed.
	ActionPane bool
}

const (
	targetInteractExecute   uint8 = 0x01
	targetInteractCancel    uint8 = 0x02
	targetInteractGroundLeg uint8 = 0x02
	targetInteractItemKind  uint8 = 0x01
	targetInteractAttackLeg uint8 = 0x01
	targetInteractActionLeg uint8 = 0x03
	targetInteractActorKind uint8 = 0x01
)

// Encode returns the exact native 0x72CD engage payload.
func (b BasicAttackEngage) Encode() []byte {
	leg := targetInteractAttackLeg
	if b.ActionPane {
		leg = targetInteractActionLeg
	}
	return NewWriter(7).
		U8(targetInteractExecute).
		U8(leg).
		U8(targetInteractActorKind).
		U32(b.TargetGid).
		Payload()
}

// DecodeBasicAttackEngage accepts only the two executable-authored attack
// forms above. In particular it cannot reinterpret pickup or explicit-skill
// bodies as combat.
func DecodeBasicAttackEngage(payload []byte) (BasicAttackEngage, error) {
	var out BasicAttackEngage
	r := NewReader(payload)
	lead, err := r.U8()
	if err != nil {
		return out, err
	}
	leg, err := r.U8()
	if err != nil {
		return out, err
	}
	kind, err := r.U8()
	if err != nil {
		return out, err
	}
	if lead != targetInteractExecute || kind != targetInteractActorKind ||
		(leg != targetInteractAttackLeg && leg != targetInteractActionLeg) {
		return out, fmt.Errorf(
			"wire: 0x72CD discriminators %02X %02X %02X are not a basic-attack engage",
			lead, leg, kind,
		)
	}
	if out.TargetGid, err = r.U32(); err != nil {
		return out, err
	}
	out.ActionPane = leg == targetInteractActionLeg
	if out.TargetGid == 0 {
		return BasicAttackEngage{}, fmt.Errorf("wire: 0x72CD basic-attack target gid is zero")
	}
	return out, r.Done()
}

// Encode returns the 0x72CD payload.
func (t TargetInteract) Encode() []byte {
	if t.Cancel {
		return []byte{targetInteractCancel}
	}
	return NewWriter(7).
		U8(targetInteractExecute).
		U8(targetInteractGroundLeg).
		U8(targetInteractItemKind).
		U32(t.Gid).
		Payload()
}

// DecodeTargetInteract parses a 0x72CD payload, accepting exactly the two
// pinned forms.
func DecodeTargetInteract(payload []byte) (TargetInteract, error) {
	var out TargetInteract
	r := NewReader(payload)

	lead, err := r.U8()
	if err != nil {
		return out, err
	}

	switch lead {
	case targetInteractCancel:
		out.Cancel = true
		return out, r.Done()
	case targetInteractExecute:
		leg, err := r.U8()
		if err != nil {
			return out, err
		}
		kind, err := r.U8()
		if err != nil {
			return out, err
		}
		if leg != targetInteractGroundLeg || kind != targetInteractItemKind {
			return out, fmt.Errorf("wire: 0x72CD discriminators %02X %02X are not the ground-item leg", leg, kind)
		}
		if out.Gid, err = r.U32(); err != nil {
			return out, err
		}
		return out, r.Done()
	default:
		return out, fmt.Errorf("wire: 0x72CD lead byte 0x%02X is neither execute nor cancel", lead)
	}
}
