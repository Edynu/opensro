package enterworld

import (
	"reflect"
	"testing"
)

// fillNonZero gives every reachable field a distinct non-zero value.
func fillNonZero(v reflect.Value, seed *int) {
	*seed++
	switch v.Kind() {
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(int64(*seed % 100))
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		v.SetUint(uint64(*seed % 100))
	case reflect.Float32, reflect.Float64:
		v.SetFloat(float64(*seed))
	case reflect.String:
		v.SetString("x")
	case reflect.Array:
		for i := 0; i < v.Len(); i++ {
			fillNonZero(v.Index(i), seed)
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).IsExported() {
				fillNonZero(v.Field(i), seed)
			}
		}
	case reflect.Slice:
		s := reflect.MakeSlice(v.Type(), 1, 1)
		fillNonZero(s.Index(0), seed)
		v.Set(s)
	case reflect.Pointer:
		p := reflect.New(v.Type().Elem())
		fillNonZero(p.Elem(), seed)
		v.Set(p)
	}
}

// residentSkill copies SkillRow field by field; a field missing from that copy
// silently reads back as zero for every server consumer and UI projection.
func TestCompactSkillRoundTripsEverySkillRowField(t *testing.T) {
	var row SkillRow
	seed := 0
	fillNonZero(reflect.ValueOf(&row).Elem(), &seed)
	got := compactSkill(row).value()
	rv, gv := reflect.ValueOf(row), reflect.ValueOf(got)
	for i := 0; i < rv.NumField(); i++ {
		if !reflect.DeepEqual(rv.Field(i).Interface(), gv.Field(i).Interface()) {
			t.Errorf("SkillRow.%s is lost by residentSkill compaction", rv.Type().Field(i).Name)
		}
	}
}
