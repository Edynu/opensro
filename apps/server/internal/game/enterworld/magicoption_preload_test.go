package enterworld

import "testing"

type alchemyOptionSource map[uint32]MagicOptionRow

func (s alchemyOptionSource) MagicOptionByParamID(id uint32) (*MagicOptionRow, bool) {
	r, ok := s[id]
	return &r, ok
}

func TestMagicOptionSnapshotPreloadsFutureAlchemyResults(t *testing.T) {
	deps := &Deps{MagicOptions: alchemyOptionSource{
		3:  {ParamID: 3, OptionName: "MATTR_DEC_MAXDUR", Degree: 3},
		11: {ParamID: 11, OptionName: "MATTR_STR", Degree: 1},
	}, ExtraMagicOptionIDs: func() []uint32 { return []uint32{11, 3, 11} }}
	rows := buildMagicOptionSnapshot(deps, &Character{})
	if len(rows) != 2 || rows[0].ParamID != 3 || rows[1].ParamID != 11 {
		t.Fatalf("future options missing, duplicated or unordered: %+v", rows)
	}
	deps.ExtraMagicOptionIDs = nil
	if got := buildMagicOptionSnapshot(deps, &Character{}); len(got) != 0 {
		t.Fatalf("detached fixture acquired Alchemy definitions: %+v", got)
	}
}

func TestMagicOptionTooltipCatalogueIncludesUnownedDegreeBrackets(t *testing.T) {
	source := sharedShippedMagicOptions(t)
	rows := buildMagicOptionSnapshot(&Deps{MagicOptions: source}, &Character{})
	if len(rows) != source.Len() || len(rows) < 200 {
		t.Fatalf("incomplete immutable catalogue: %d", len(rows))
	}
	found := false
	for i, row := range rows {
		if i > 0 && rows[i-1].ParamID >= row.ParamID {
			t.Fatal("unordered catalogue")
		}
		if row.OptionName == "MATTR_STR" && row.Degree == 1 {
			found = true
			if row.RangeWords == nil || *row.RangeWords != [3]uint32{65538, 196608, 0} {
				t.Fatalf("native bracket words lost: %+v", row)
			}
		}
	}
	if !found {
		t.Fatal("missing native STR degree 1")
	}
}
