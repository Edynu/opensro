package wire

// OpActionState is the 0xB2CD action-state latch write (handler sub_75baa0).
//
// The server owns the client's generic object-action session latch. Pickup is
// one user: it arms an out-of-range approach and releases every terminal
// outcome. Cancel-active-effect is another: it closes the short action
// session independently of the later effect-retirement packet. A missed
// release wedges client action ownership.
const OpActionState uint16 = 0xB2CD

// Action-state kinds shared by the native object-action session.
const (
	// ActionStateKindArm arms the approach latch (State 1 = pending,
	// cancellable: the client may still click away, which fires the bare
	// 0x72CD [2] cancel once +0x618 == 1).
	ActionStateKindArm uint8 = 0x01
	// ActionStateKindRelease is the plain terminal release (State 0) that
	// leads every grant and refusal burst.
	ActionStateKindRelease uint8 = 0x02
	// ActionStateKindNotice is the refusal-notice form; it is the only kind
	// that carries the trailing error byte. Pickup errors do NOT use it -
	// they surface through the 0xB06D notice - but the wire form exists and
	// the parser must know its length.
	ActionStateKindNotice uint8 = 0x03
)

// ActionState is one 0xB2CD payload: [u8 kind][u8 actionState], plus
// [u8 errorCode] only when Kind is ActionStateKindNotice.
type ActionState struct {
	Kind      uint8
	State     uint8
	ErrorCode uint8
}

// Encode returns the 0xB2CD payload. The error byte is only present on the
// kind-3 notice form, mirroring buildMissionActionStatePacket.
func (a ActionState) Encode() []byte {
	w := NewWriter(3).U8(a.Kind).U8(a.State)
	if a.Kind == ActionStateKindNotice {
		w.U8(a.ErrorCode)
	}
	return w.Payload()
}

// DecodeActionState parses a 0xB2CD payload.
func DecodeActionState(payload []byte) (ActionState, error) {
	var out ActionState
	r := NewReader(payload)

	kind, err := r.U8()
	if err != nil {
		return out, err
	}
	state, err := r.U8()
	if err != nil {
		return out, err
	}
	out.Kind = kind
	out.State = state

	if kind == ActionStateKindNotice {
		if out.ErrorCode, err = r.U8(); err != nil {
			return out, err
		}
	}
	return out, r.Done()
}

// ReleaseActionState returns the terminal release used by completed generic
// object actions (including pickup outcomes and cancel-active-effect).
func ReleaseActionState() ActionState {
	return ActionState{Kind: ActionStateKindRelease, State: 0}
}

// NoticeActionState is the kind-3 refusal: state is the actor's queued
// command count, code the notice the client shows under category 0x19.
func NoticeActionState(state, code uint8) ActionState {
	return ActionState{Kind: ActionStateKindNotice, State: state, ErrorCode: code}
}

// ArmActionState returns the approach arm an out-of-range pickup answers with.
func ArmActionState() ActionState {
	return ActionState{Kind: ActionStateKindArm, State: 1}
}
