package enterworld

import (
	"strconv"
	"testing"
)

func TestAlchemyBonusReadsPrimaryAndTailBlocks(t *testing.T) {
	for _, at := range []int{69, 88} {
		fields := make([]string, 118)
		for i := range fields {
			fields[i] = "0"
		}
		fields[at] = strconv.Itoa(0x616c6375)
		fields[at+1] = "10"
		fields[at+2] = strconv.Itoa(0x6c75636b)
		fields[at+3] = "5"
		if encodedAlchemyBonus(fields, 0x616c6375) != 10 || encodedAlchemyBonus(fields, 0x6c75636b) != 5 {
			t.Fatal("wrong tag projection")
		}
		fields[at+1] = "-1"
		if encodedAlchemyBonus(fields, 0x616c6375) != 0 {
			t.Fatal("negative bonus wrapped")
		}
	}
}
