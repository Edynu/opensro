package texttable

import (
	"reflect"
	"strings"
	"testing"
	"unsafe"
)

func TestCellsDetachSourceAndPreserveEmptyAndUnicodeFields(t *testing.T) {
	source := strings.Repeat("unused", 1000) + "\tname\t\t中文\tname"
	cells := make(Cells)
	got := cells.Split(source)
	if !reflect.DeepEqual(got, strings.Split(source, "\t")) {
		t.Fatal("field values changed")
	}
	base := uintptr(unsafe.Pointer(unsafe.StringData(source)))
	for _, field := range got {
		if field == "" {
			continue
		}
		p := uintptr(unsafe.Pointer(unsafe.StringData(field)))
		if p >= base && p < base+uintptr(len(source)) {
			t.Fatal("field retains source file")
		}
	}
	if unsafe.StringData(got[1]) != unsafe.StringData(got[4]) {
		t.Fatal("duplicate cells were not shared")
	}
}
