package party

// ExpireInvitations runs on the mission coordinator. Native 46CE20 loads
// 2C10 and 5BEAC0 dispatches to both proposal participants. The v1.150
// proposer shows category 2/code 10; B452 closes the invitee's party prompt.
func (r *Runtime) ExpireInvitations(nowMs int64) {
	for _, invite := range r.registry.ExpirePendingInvites(nowMs) {
		ack := OpCreatePartyAck
		if invite.Kind == PendingInviteJoin {
			ack = OpPartyJoinInviteAck
		}
		if s, ok := r.sessionByName(invite.divisionID, invite.InviterName); ok {
			_ = s.Send(ack, []byte{2, 0x10})
		}
		if s, ok := r.sessionByName(invite.divisionID, invite.targetName); ok {
			_ = s.Send(OpPartyJoinAck, []byte{2, 0x10})
		}
	}
}
