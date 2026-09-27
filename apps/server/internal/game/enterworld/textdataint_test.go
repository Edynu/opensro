/*
===========================================================================

textdataint_test.go - textdataInt fast path against the float path

===========================================================================
*/

package enterworld

import (
	"strconv"
	"testing"
)

// textdataInt's decimal fast path must agree with the Number()-style float
// path on every cell shape the media can hold.
func TestTextdataIntFastPathMatchesFloatPath(t *testing.T) {
	floatPath := func(value string) (int64, bool) {
		f, ok := textdataFloat(value)
		if !ok || f != float64(int64(f)) {
			return 0, false
		}
		return int64(f), true
	}
	cells := []string{"0", "-0", "+0", "7", "007", "-12", "+12", "42.0", " 5 ", "", "-", "+", "1e3", "0x10",
		"2147483647", "4294967295", "-2147483648", "9007199254740992", "9007199254740993", "-9007199254740993",
		"99999999999999999999", "1868981072", "3.5", "abc", "12a"}
	for v := int64(-2000); v <= 2000; v += 7 {
		cells = append(cells, strconv.FormatInt(v, 10))
	}
	for _, cell := range cells {
		gotV, gotOK := textdataInt(cell)
		wantV, wantOK := floatPath(cell)
		if gotV != wantV || gotOK != wantOK {
			t.Fatalf("%q: fast (%d,%v) float (%d,%v)", cell, gotV, gotOK, wantV, wantOK)
		}
	}
}
