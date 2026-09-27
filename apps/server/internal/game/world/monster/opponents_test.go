package monster

import "testing"

func TestOpponentPoliciesAndScores(t *testing.T) {
	candidates := [3]OpponentCandidate{{1, true, 10}, {2, true, 20}, {3, true, 30}}
	for _, policy := range []uint8{0, 1, 2} {
		var rows [2]Opponent
		if got := RecordOpponentHit(&rows, policy, 1, 10, 100, 0, 1000, 1000, candidates); got != 1 {
			t.Fatal(got)
		}
		got := RecordOpponentHit(&rows, policy, 2, 20, 50, 0, 1100, 1000, candidates)
		want := uint32(1)
		if policy == 1 {
			want = 2
		}
		if got != want {
			t.Fatalf("policy %d: %d", policy, got)
		}
		got = RecordOpponentHit(&rows, policy, 2, 20, 100, 0, 1200, 1000, candidates)
		if policy != 0 {
			want = 2
		}
		if got != want {
			t.Fatalf("policy %d stronger: %d", policy, got)
		}
		if policy == 2 && (rows[0].GID != 2 || rows[0].Damage != 40 || rows[0].Aggression != 150 || rows[0].HitCount != 2) {
			t.Fatalf("record %+v", rows)
		}
	}
}

func TestOpponentExpiryInvalidationAndThirdAttacker(t *testing.T) {
	candidates := [3]OpponentCandidate{{1, true, 10}, {2, true, 20}, {3, true, 30}}
	rows := [2]Opponent{{GID: 1, Aggression: 100, LastHitMs: 1000}, {GID: 2}}
	if got := RecordOpponentHit(&rows, 2, 2, 1, 1, 0, 2999, 1000, candidates); got != 1 {
		t.Fatal("early expiry")
	}
	if got := RecordOpponentHit(&rows, 2, 2, 1, 1, 0, 3000, 1000, candidates); got != 2 {
		t.Fatal("missed exact expiry")
	}
	before := rows
	if got := RecordOpponentHit(&rows, 2, 3, 1, 999, 0, 3001, 1000, candidates); got != 2 || rows != before {
		t.Fatal("third distant attacker displaced records")
	}
	candidates[2].Distance = 5
	if got := RecordOpponentHit(&rows, 2, 3, 1, 999, 0, 3002, 1000, candidates); got != 3 || rows[0].Aggression != 0 || rows[1].GID != 2 {
		t.Fatalf("third near %+v", rows)
	}
	candidates[2].Eligible = false
	if got := RecordOpponentHit(&rows, 2, 2, 1, 1, 0, 3003, 1000, candidates); got != 2 || rows[1] != (Opponent{}) {
		t.Fatalf("invalid primary %+v", rows)
	}
}

func TestOpponentSignedArithmeticAndClockWrap(t *testing.T) {
	rows := [2]Opponent{{GID: 1, Aggression: 0x7fffffff, HitCount: 255}}
	RecordOpponentHit(&rows, 2, 1, 1, 1, 0, 0, 1000, [3]OpponentCandidate{})
	if rows[0].Aggression != 0 || rows[0].HitCount != 0 {
		t.Fatal(rows)
	}
	rows = [2]Opponent{{GID: 1, Aggression: 100, LastHitMs: 0xfffffff0}, {GID: 2}}
	if got := RecordOpponentHit(&rows, 2, 2, 1, 1, 0, 16, 16, [3]OpponentCandidate{{1, true, 1}, {2, true, 2}}); got != 2 {
		t.Fatal("clock rollover", got)
	}
}
