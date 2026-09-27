package wire

import "testing"

func TestPeerNameStateRoundTripSeparatesInactiveFromTeamZero(t *testing.T) {
	for _, team := range []uint8{255, 0, 1} {
		for _, state := range []uint8{0, 1, 2} {
			row := PlayerSpawnRow{Gid: 100002, Name: "asd2", PVPState: state}
			if team != 255 {
				row.EventTeam = &team
			}
			decoded, err := DecodePlayerSpawnRow(row.Encode(), nil, false)
			if err != nil {
				t.Fatal(err)
			}
			actual := uint8(255)
			if decoded.EventTeam != nil {
				actual = *decoded.EventTeam
			}
			if actual != team || decoded.PVPState != state {
				t.Fatalf("team %d state %d -> team %d state %d", team, state, actual, decoded.PVPState)
			}
		}
	}
}
