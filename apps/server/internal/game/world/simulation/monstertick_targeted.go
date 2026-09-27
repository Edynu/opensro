package simulation

// monsterTargetFrames is the actor-private consequence of one monster action.
// The public action frames and this tail share one RunMonsterLeg transaction,
// but have deliberately different audiences.
type monsterTargetFrames struct {
	TargetGid uint32
	Frames    []Frame
}

// deliverMonsterTargetFrames resolves the target against the coordinator's
// already-sampled session set. It must not poll SessionSource again: one tick
// owns one immutable participant snapshot, and a second read can both reorder
// lifecycle changes and make a private consequence miss its original actor.
func deliverMonsterTargetFrames(
	divisionID string,
	targeted *monsterTargetFrames,
	sessions []SessionSnapshot,
	push Pusher,
) {
	if targeted == nil || len(targeted.Frames) == 0 {
		return
	}
	for _, session := range sessions {
		if session.DivisionID == divisionID &&
			PlayerObjectID(session.CharacterID) == targeted.TargetGid {
			push.PushToSession(session.SessionID, targeted.Frames)
			return
		}
	}
}
