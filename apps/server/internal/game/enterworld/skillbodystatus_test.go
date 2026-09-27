package enterworld

import (
	"strconv"
	"testing"
)

func TestBodyStatusDescriptorAdmission(t *testing.T) {
	for _, tc := range []struct {
		tail               []uint32
		present, supported bool
		value              uint8
	}{
		{[]uint32{0x64757261, 100, 0x68696465, 1, 0, 0, 0x73736f75}, true, true, 6},
		{[]uint32{0x68696465, 2, 0, 0, 0x6e627566, 0x73736f75}, true, true, 7},
		{[]uint32{0x68696465, 1, 0, 50, 0x73736f75}, true, false, 6},
		{[]uint32{0x68696465, 1, 1, 0, 0x73736f75}, true, false, 6},
		{[]uint32{0x68696465, 1, 0, 0, 0x63627566, 0x73736f75}, true, false, 6}, // cbuf changes death retirement
		{[]uint32{0x68696465, 3, 0, 0, 0x73736f75}, true, false, 0},
		{[]uint32{0x68696465, 1, 0, 0, 0x61626364, 0x73736f75}, true, false, 6},
		{[]uint32{0x68696465, 1}, true, false, 0},
		{[]uint32{0x64757261, 0x68696465, 0x73736f75}, false, false, 0},
	} {
		fields := make([]string, 69)
		for _, n := range tc.tail {
			fields = append(fields, strconv.FormatUint(uint64(n), 10))
		}
		got := encodedBodyStatus(fields)
		if got.Present != tc.present || got.Supported != tc.supported || got.Value != tc.value {
			t.Fatalf("%v: %+v", tc.tail, got)
		}
	}
}
