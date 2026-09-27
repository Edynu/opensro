package simulation

import (
	"fmt"

	"opensro.online/server/internal/game/item/wire"
)

// Native agent-result codes shared by movement parsing and validation.
// These are protocol values, not package-local implementation choices.
const (
	NativeErrorInvalidRequest   uint8 = 0x02
	NativeErrorUnknownCharacter uint8 = 0x10
)

// MovementRequest is one accepted 0x7738 movement request: a ground-click
// destination (mode 1) or an angular turn-in-place (mode 0).
type MovementRequest struct {
	// Mode is the 0xB738 mode byte; MovementAckDestinationMode for a plain
	// ground destination, MovementAckAngularMode for a turn-in-place.
	Mode     uint8
	RegionID uint16
	X        float64
	Y        float64
	Z        float64
	// AngularMode is the angular-form rotation byte (record +0x0e in
	// sub_877cc0). The only native producer on 0x7738 (sub_877f30 /
	// CharMovement_RequestTurnInPlace) sends 1; the ack parser sub_776170
	// reads the echoed byte back as its rotation flag.
	AngularMode uint8
	// HeadingWord is the angular-form facing in the native 1/65535-circle
	// wire unit (the angle-encoding block in moverequest.go) - the same
	// unit Spawn.Angle stores, so the server applies it as a direct store
	// with no float round trip.
	HeadingWord uint16
}

// NormalizeMovementRequest applies the reference coercion ranges
// (coerceMissionMovementRequest): x/z clamp into [0, 0xffff], y into
// [-0x8000, 0x7fff], and a zero mode takes the destination default. The
// transport layer owns rejecting structurally absent fields; by the time a
// typed request exists the reference behavior is clamping, not refusal.
//
// POSITIONAL FORM ONLY: the zero-mode coerce predates the turn lane (it
// papers over the JSON path's absent mode field) and would silently rewrite
// an ANGULAR request (Mode == MovementAckAngularMode == 0) into a ground
// destination. DecodeClientMovementRequest deliberately returns the angular
// arm WITHOUT normalizing; never route a mode-0 request through here.
func NormalizeMovementRequest(m MovementRequest) MovementRequest {
	if m.Mode < 1 {
		m.Mode = MovementAckDestinationMode
	}
	m.X = clampFloat(m.X, 0, 0xffff)
	m.Y = clampFloat(m.Y, -0x8000, 0x7fff)
	m.Z = clampFloat(m.Z, 0, 0xffff)
	return m
}

// MovementSource is the optional 0xB738 source block. Player acknowledgements
// use it on their first post-entry move; autonomous entities use it when a
// new leg makes a discontinuous turn from their current movement vector.
type MovementSource struct {
	RegionID uint16
	X        float64
	Y        float64
	Z        float64
}

// MovementSourceFromSpawn mirrors movementSourceFromMissionSpawn. Note the
// reference reads the GOAL plane (world.spawn) for the source block, not the
// live plane - preserved as-is.
func MovementSourceFromSpawn(spawn Spawn) MovementSource {
	return MovementSource{RegionID: spawn.RegionID, X: spawn.X, Y: spawn.Y, Z: spawn.Z}
}

// BuildMovementAckPayload encodes the 0xB738 payload exactly as the client
// parser consumes it (sub_776200 -> sub_776170):
//
//	[u32 objectId][u8 mode]
//	then mode!=0: [u16 region][u16 x][u16 y][u16 z]
//	or   mode=0:  [u8 angularMode][u16 headingWord]
//	then [u8 1][u16 srcRegion][u16 srcX*10][f32 srcY][u16 srcZ*10]
//	or   [u8 0]
//
// The angular arm mirrors sub_776170's mode-0 read ([u8 rotationFlag]
// [u16 headingWord] @0x77619b..0x7761b1) and carries the request's own
// bytes back - the same verbatim-echo contract as the destination arm.
//
// RETAIL WIRE PARITY: the native 0xB738 handler (sub_776200 at
// 0x007762c1..0x007762ff) divides the source-block X/Z i16 fields by 10.0f,
// so the server PREMULTIPLIES them by 10 (the middle Y dword stays a raw
// float). The active-probe's unscaled source block is the known-wrong shape
// (REV-1 finding 4); do not copy it.
func BuildMovementAckPayload(objectID uint32, movement MovementRequest, source *MovementSource) []byte {
	w := wire.NewWriter(20)
	w.U32(objectID).U8(movement.Mode)

	if movement.Mode == MovementAckAngularMode {
		w.U8(movement.AngularMode).U16(movement.HeadingWord)
	} else {
		w.U16(movement.RegionID).
			U16(roundU16(movement.X)).
			U16(roundU16(movement.Y)).
			U16(roundU16(movement.Z))
	}

	if source != nil {
		w.U8(1).
			U16(source.RegionID).
			U16(roundU16(source.X * 10)).
			F32(float32(source.Y)).
			U16(roundU16(source.Z * 10))
	} else {
		w.U8(0)
	}

	return w.Payload()
}

// MoveError is a refused move, carrying the native agent error code the
// reference failure envelope ships (0x02 invalid request, 0x10 unknown
// character - describeNativeAgentError's domain).
type MoveError struct {
	NativeErrorCode uint8
	Reason          string
}

func (e *MoveError) Error() string {
	return fmt.Sprintf("simulation move refused: %s (native 0x%02X)", e.Reason, e.NativeErrorCode)
}

// ErrUnsupportedMoveOpcode mirrors the reference refusal for a nativeOpcode
// that is present but not 0x7738.
func ErrUnsupportedMoveOpcode(opcode uint16) *MoveError {
	return &MoveError{NativeErrorCode: NativeErrorInvalidRequest, Reason: fmt.Sprintf("unsupportedNativeMoveOpcode 0x%04X", opcode)}
}

// MovementValidator is the deep-water destination gate seam
// (validateMissionMovementForWorld). The reference implementation loads the
// MAPM water table for the destination region and refuses mode-1 targets
// submerged more than 12u; the asset-backed port is movement.WaterValidator
// (internal/game/world/movement/water.go), wired in server.go. A nil validator accepts
// everything, which is also the reference behaviour when the surface asset
// is unreadable.
type MovementValidator interface {
	ValidateMovement(m MovementRequest) *MoveError
}

// MoveResult is one accepted move: the ack payload plus the state-transition
// witnesses parity tests assert on.
type MoveResult struct {
	// AckPayload is the 0xB738 body (wrap with OpMovementAck).
	AckPayload []byte
	// LiveBefore is where the character actually was when the click landed -
	// a resteer departs from the interpolated point of the PREVIOUS segment,
	// not its goal.
	LiveBefore Spawn
	// NextSpawn is the accepted goal written to WorldState.Spawn.
	NextSpawn Spawn
	// Segment is the new live-plane segment (nil for a zero-length hop).
	Segment *MoveSegment
	// SourceIncluded reports whether the ack carried the one-shot source block.
	SourceIncluded bool
	// MovementMode is the run/walk mode the travel was timed with.
	MovementMode uint8
}

// ApplyMove runs the accepted-move state transition of moveMissionCharacter
// on a WorldState (everything after validation; persistence and packet
// wrapping stay with the caller):
//
//  1. the one-shot source block comes from the GOAL plane if never seeded;
//  2. the departure point is the LIVE plane (bug D: a mid-move resteer
//     departs from the interpolated point, not the previous goal);
//  3. the goal plane takes the destination, facing the travel direction;
//  4. the live plane gets a fresh segment (or nil for a zero-length hop,
//     clearing any stale segment);
//  5. run/walk mode, spawnSet and movementSourceSeeded latch.
//
// The angular turn-in-place form routes to applyTurn - no travel, no speed
// semantics, just the facing.
func ApplyMove(world *WorldState, objectID uint32, movement MovementRequest, movementMode uint8, nowMs int64) MoveResult {
	if movement.Mode == MovementAckAngularMode {
		return applyTurn(world, objectID, movement, nowMs)
	}

	movementMode = CoerceRunWalkMode(movementMode, world.MovementMode)

	var source *MovementSource
	if !world.MovementSourceSeeded {
		s := MovementSourceFromSpawn(world.Spawn)
		source = &s
	}

	liveBefore := world.LiveSpawnAt(nowMs)
	nextSpawn := SpawnFromMovement(movement, liveBefore)

	world.Spawn = nextSpawn
	world.MoveSegment = world.TravelSegment(liveBefore, nextSpawn, movementMode, nowMs)
	world.MovementMode = movementMode
	world.SpawnSet = true
	world.MovementSourceSeeded = true

	return MoveResult{
		AckPayload:     BuildMovementAckPayload(objectID, movement, source),
		LiveBefore:     liveBefore,
		NextSpawn:      nextSpawn,
		Segment:        world.MoveSegment,
		SourceIncluded: source != nil,
		MovementMode:   movementMode,
	}
}

// applyTurn runs the accepted TURN-IN-PLACE state transition, the server
// half of the native mode-0 ack contract (sub_776200 @0x77624c..0x77628c):
// when the source block rides the ack, the client seeds the PathCtl source
// AND goal to the SAME point and applies yaw =
// Math_NormalizeRadians(headingRadians) via PathCtl_SetSourceGoalAndYaw,
// then enters motion state 9 - i.e. the character SETTLES where it stands,
// facing the heading; no travel starts.
//
//  1. the one-shot source block follows the same first-ack latch as a
//     ground move (the client's mode-0 yaw leg only runs when the source
//     block is present - sub_776200 gates PathCtl_SetSourceGoalAndYaw
//     under sourcePositionFlag == 1 @0x776253);
//  2. the goal plane takes the LIVE point (a mid-flight turn settles at
//     the interpolated position - the bug-D plane, mirroring the client's
//     source==goal snap) with Angle = the wire word, a direct store: the
//     heading word and Spawn.Angle share the 1/65535-circle unit, so no
//     float round trip touches it;
//  3. any in-flight segment clears (motion state 9 = settled);
//  4. run/walk mode is NOT touched - the native destination-ack vs
//     run/walk separation holds: a turn carries no speed semantics;
//     spawnSet and movementSourceSeeded latch like every accepted move.
func applyTurn(world *WorldState, objectID uint32, movement MovementRequest, nowMs int64) MoveResult {
	var source *MovementSource
	if !world.MovementSourceSeeded {
		s := MovementSourceFromSpawn(world.Spawn)
		source = &s
	}

	liveBefore := world.LiveSpawnAt(nowMs)
	nextSpawn := liveBefore
	nextSpawn.Angle = movement.HeadingWord

	// A turn settles where the walker stands, on the same native cell.
	world.SettleLive(nowMs)
	world.Spawn = nextSpawn
	world.SpawnSet = true
	world.MovementSourceSeeded = true

	return MoveResult{
		AckPayload:     BuildMovementAckPayload(objectID, movement, source),
		LiveBefore:     liveBefore,
		NextSpawn:      nextSpawn,
		Segment:        nil,
		SourceIncluded: source != nil,
		MovementMode:   world.MovementMode,
	}
}
