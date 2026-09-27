package monster

import "testing"

func TestFollowLocationCompatibilityBoundaries(t *testing.T) {
	for _, test := range []struct {
		name        string
		left, right uint16
		want        bool
	}{
		{"same", 0x62aa, 0x62aa, true},
		{"diagonal", 0x62aa, 0x63ab, true},
		{"two columns", 0x62aa, 0x62ac, false},
		{"two rows", 0x62aa, 0x64aa, false},
		{"column cannot wrap", 0x6200, 0x62ff, false},
		{"outdoor dungeon", 0x62aa, 0xe2aa, false},
		{"both dungeon words", 0x8000, 0xffff, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if FollowLocationCompatible(test.left, test.right) != test.want || FollowLocationCompatible(test.right, test.left) != test.want {
				t.Fatal("location predicate or symmetry differs")
			}
		})
	}
}

func TestFollowStateBindsLeaderAndRetaliationReleasesIt(t *testing.T) {
	mover := coherentMover(MoverIdle)
	if err := mover.Transition(MoverEventFollowStarted, 0); err == nil {
		t.Fatal("unbound FOLLOW accepted")
	}
	if err := mover.Transition(MoverEventFollowStarted, 400001); err != nil {
		t.Fatal(err)
	}
	if mover.TargetGID() != 0 || mover.FollowLeaderGID() != 400001 {
		t.Fatal("leader became attack target")
	}
	if err := mover.Transition(MoverEventRetaliationArmed, 100001); err != nil {
		t.Fatal(err)
	}
	if mover.FollowLeaderGID() != 0 || mover.TargetGID() != 100001 {
		t.Fatal("retaliation retained FOLLOW ownership")
	}
}
