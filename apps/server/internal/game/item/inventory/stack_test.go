package inventory

import "testing"

func TestMergeStacks(t *testing.T) {
	cases := []struct {
		name      string
		source    uint16
		dest      uint16
		requested uint16
		stackCap  uint16
		want      MergeResult
	}{
		{
			name:   "whole source fits",
			source: 10, dest: 5, requested: 0, stackCap: 20,
			want: MergeResult{Moved: 10, SourceQuantity: 0, DestQuantity: 15, Complete: true},
		},
		{
			name:   "capped by the destination's headroom",
			source: 10, dest: 15, requested: 0, stackCap: 20,
			want: MergeResult{Moved: 5, SourceQuantity: 5, DestQuantity: 20, Complete: false},
		},
		{
			name:   "explicit partial request",
			source: 10, dest: 5, requested: 3, stackCap: 20,
			want: MergeResult{Moved: 3, SourceQuantity: 7, DestQuantity: 8, Complete: false},
		},
		{
			name:   "request larger than the source moves only the source",
			source: 4, dest: 0, requested: 99, stackCap: 20,
			want: MergeResult{Moved: 4, SourceQuantity: 0, DestQuantity: 4, Complete: true},
		},
		{
			name:   "destination already at the cap takes nothing",
			source: 10, dest: 20, requested: 0, stackCap: 20,
			want: MergeResult{Moved: 0, SourceQuantity: 10, DestQuantity: 20, Complete: false},
		},
		{
			// Nothing to move, and the source row is already empty, so it
			// reports Complete for the caller that removes emptied rows.
			name:   "empty source is a no-op",
			source: 0, dest: 5, requested: 0, stackCap: 20,
			want: MergeResult{Moved: 0, SourceQuantity: 0, DestQuantity: 5, Complete: true},
		},
		{
			name:   "non-stacking items behave as a cap of one",
			source: 1, dest: 1, requested: 0, stackCap: 1,
			want: MergeResult{Moved: 0, SourceQuantity: 1, DestQuantity: 1, Complete: false},
		},
		{
			name:   "a cap of zero is treated as one rather than dividing by nothing",
			source: 1, dest: 0, requested: 0, stackCap: 0,
			want: MergeResult{Moved: 1, SourceQuantity: 0, DestQuantity: 1, Complete: true},
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := MergeStacks(testCase.source, testCase.dest, testCase.requested, testCase.stackCap)
			if got != testCase.want {
				t.Fatalf("MergeStacks(%d, %d, %d, %d) = %+v, want %+v",
					testCase.source, testCase.dest, testCase.requested, testCase.stackCap,
					got, testCase.want)
			}
		})
	}
}

// A merge conserves units: nothing may be created or destroyed by moving a
// stack around.
func TestMergeStacksConservesUnits(t *testing.T) {
	const stackCap = 20

	for source := uint16(0); source <= 25; source++ {
		for dest := uint16(0); dest <= 25; dest++ {
			got := MergeStacks(source, dest, 0, stackCap)

			if total := got.SourceQuantity + got.DestQuantity; total != source+dest {
				t.Fatalf("MergeStacks(%d, %d) totals %d, want %d", source, dest, total, source+dest)
			}
			// Moved must agree with both sides of the transfer.
			if got.Moved != source-got.SourceQuantity {
				t.Fatalf("MergeStacks(%d, %d) moved %d but the source lost %d",
					source, dest, got.Moved, source-got.SourceQuantity)
			}
			if got.Moved != got.DestQuantity-dest {
				t.Fatalf("MergeStacks(%d, %d) moved %d but the destination gained %d",
					source, dest, got.Moved, got.DestQuantity-dest)
			}
			// A destination that started within the cap must not end past it.
			if dest <= stackCap && got.DestQuantity > stackCap {
				t.Fatalf("MergeStacks(%d, %d) overflowed the cap to %d", source, dest, got.DestQuantity)
			}
			if got.Complete != (got.SourceQuantity == 0) {
				t.Fatalf("MergeStacks(%d, %d) reported Complete=%v with %d left on the source",
					source, dest, got.Complete, got.SourceQuantity)
			}
		}
	}
}

func TestSplitStack(t *testing.T) {
	remaining, split, fault := SplitStack(20, 5)
	if fault != nil {
		t.Fatalf("SplitStack refused: %v", fault)
	}
	if remaining != 15 || split != 5 {
		t.Fatalf("SplitStack(20, 5) = %d remaining, %d split; want 15 and 5", remaining, split)
	}
}

// The quantity dialog caps its spinner one below the stack count: taking the
// whole stack is a move, not a split.
func TestSplitStackRefusals(t *testing.T) {
	cases := []struct {
		name      string
		source    uint16
		requested uint16
		reason    string
	}{
		{"zero requested", 20, 0, "invalidSplitQuantity"},
		{"the whole stack", 20, 20, "splitExceedsStack"},
		{"more than the stack", 20, 21, "splitExceedsStack"},
		{"a single unit cannot be split", 1, 1, "splitExceedsStack"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			remaining, split, fault := SplitStack(testCase.source, testCase.requested)
			if fault == nil {
				t.Fatal("SplitStack was allowed, want a refusal")
			}
			if fault.Reason != testCase.reason {
				t.Fatalf("reason = %q, want %q", fault.Reason, testCase.reason)
			}
			if remaining != testCase.source || split != 0 {
				t.Fatalf("a refused split returned %d remaining and %d split; want %d and 0",
					remaining, split, testCase.source)
			}
		})
	}
}

func TestSplitStackConservesUnits(t *testing.T) {
	const source = 20
	for requested := uint16(1); requested < source; requested++ {
		remaining, split, fault := SplitStack(source, requested)
		if fault != nil {
			t.Fatalf("SplitStack(%d, %d) refused: %v", source, requested, fault)
		}
		if remaining+split != source {
			t.Fatalf("SplitStack(%d, %d) totals %d, want %d", source, requested, remaining+split, source)
		}
	}
}
