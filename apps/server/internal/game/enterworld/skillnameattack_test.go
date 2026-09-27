package enterworld

import (
	"strconv"
	"testing"
)

func TestNativeNameAttackContent(t *testing.T) {
	fields := make([]string, 118)
	for i := range fields {
		fields[i] = "0"
	}
	fields[22] = "1"
	// A zero-valued non-damage content block still installs a pointer.
	fields[69] = strconv.FormatInt(0x6662, 10)
	if !nativeNameAttackContent(fields) {
		t.Fatal("fb content omitted")
	}
	fields[68] = "4"
	if nativeNameAttackContent(fields) {
		t.Fatal("mode 4 must suppress")
	}
	fields[68] = "0"
	fields[22] = "0"
	if nativeNameAttackContent(fields) {
		t.Fatal("targetless content must suppress")
	}
	fields[22] = "1"
	fields[69] = strconv.FormatInt(0x61626e62, 10)
	fields[70] = strconv.FormatInt(0x6662, 10)
	if nativeNameAttackContent(fields) {
		t.Fatal("abnb must suppress")
	}
	fields[69] = strconv.FormatInt(0x73736f75, 10)
	if nativeNameAttackContent(fields) {
		t.Fatal("content after ssou must not be read")
	}
}
