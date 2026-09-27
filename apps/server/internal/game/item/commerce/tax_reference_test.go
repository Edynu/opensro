package commerce

import (
	"encoding/json"
	"os"
	"testing"
)

func TestTaxAgainstFrozenX87InstructionReference(t *testing.T) {
	data, err := os.ReadFile("testdata/x87-tax.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Base      uint64
		Percent   int16
		Precision uint
		Delta     int64
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 162 {
		t.Fatal("incomplete reference matrix", len(rows))
	}
	for _, row := range rows {
		for _, purchase := range []bool{false, true} {
			want := int64(row.Base) - row.Delta
			if purchase {
				want = int64(row.Base) + row.Delta
			}
			got, ok := AdjustPrice(row.Base, Tax{Percent: row.Percent, Precision: row.Precision}, purchase)
			if ok != (want >= 0) || ok && got != uint64(want) {
				t.Fatalf("%+v purchase=%v: got %d/%v want %d", row, purchase, got, ok, want)
			}
		}
	}
}
