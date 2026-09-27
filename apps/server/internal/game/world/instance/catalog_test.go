package instance

import (
	"strings"
	"testing"
)

func TestShippedAllocationDefinitions(t *testing.T) {
	if len(Shipped()) != 41 {
		t.Fatal("shipped world roster changed")
	}
	for _, tc := range []struct {
		id              DefinitionID
		kind            uint8
		layers, players uint16
	}{
		{1, 0, 1, 0}, {2, 0, 1, 300}, {10, 1, 100, 8}, {14, 1, 50, 500},
	} {
		row, ok := Lookup(tc.id)
		if !ok || row.NativeType != tc.kind || row.LayerLimit != tc.layers || row.PlayerLimit != tc.players {
			t.Fatalf("world %d lost allocation fields: %+v", tc.id, row)
		}
	}
	row, _ := Lookup(2)
	if row.Strings[0] != "FORTRESS_JANGAN" || row.Strings[1] != "FORT_JA_AREA" {
		t.Fatal("world string parameters lost")
	}
	copy := Shipped()
	copy[0].Strings[0] = "changed"
	row, _ = Lookup(1)
	if row.Strings[0] != "xxx" {
		t.Fatal("catalog exposed mutable ownership")
	}
}

func TestWorldCatalogPreservesEveryParameter(t *testing.T) {
	fields := strings.Split(strings.Split(shippedData, "\n")[0], "\t")
	fields[24], fields[25], fields[44] = "last-string", "-2147483648", "2147483647"
	rows, err := parseDefinitions(strings.Join(fields, "\t"))
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].Strings[19] != "last-string" || rows[0].Numbers[0] != -2147483648 || rows[0].Numbers[19] != 2147483647 {
		t.Fatal("parameter tail was projected away")
	}
	for _, bad := range []string{
		strings.Join(fields[:44], "\t"),
		strings.Join(fields, "\t") + "\t0",
		strings.Join(fields, "\t") + "\n" + strings.Join(fields, "\t"),
	} {
		if _, err := parseDefinitions(bad); err == nil {
			t.Fatal("invalid catalog admitted")
		}
	}
	fields[3] = "65536"
	if _, err := parseDefinitions(strings.Join(fields, "\t")); err == nil {
		t.Fatal("layer limit truncated")
	}
}
