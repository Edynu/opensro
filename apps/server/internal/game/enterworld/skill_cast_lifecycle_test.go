package enterworld

import (
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestNativeSkillCastLinks(t *testing.T) {
	for _, tc := range []struct {
		name       string
		next, want map[uint32]uint32
	}{
		{"retail three-stage chain", map[uint32]uint32{6: 7, 7: 8, 8: 0}, map[uint32]uint32{7: 6, 8: 6}},
		{"sorted native traversal, not map order", map[uint32]uint32{20: 10, 10: 30, 30: 0}, map[uint32]uint32{10: 20, 30: 20}},
		{"converging chain overwrite", map[uint32]uint32{1: 3, 2: 3, 3: 4, 4: 0}, map[uint32]uint32{3: 2, 4: 2}},
		{"missing child ends traversal", map[uint32]uint32{1: 99}, map[uint32]uint32{}},
		{"unlinked rows", map[uint32]uint32{1: 0, 2: 0}, map[uint32]uint32{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := nativeSkillCastLinks(tc.next)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
	for _, next := range []map[uint32]uint32{{1: 1}, {1: 2, 2: 1}, {1: 2, 2: 3, 3: 2}} {
		if _, err := nativeSkillCastLinks(next); err == nil {
			t.Fatalf("accepted cycle %v", next)
		}
	}
}
func TestNativeSkillDefersCancellation(t *testing.T) {
	const pmhp = uint32(0x706d6870)
	const other = uint32(0x617474)
	arity := func(tag uint32) int {
		switch tag {
		case 0:
			return 0
		case pmhp:
			return 4
		case other:
			return 5
		}
		return -1
	}
	for _, tc := range []struct {
		name string
		tail []int64
		want bool
	}{
		{"retail exempt", []int64{int64(pmhp), 1000, 0, 100, 0}, true},
		{"retail rogue buffs", []int64{int64(pmhp), 1000, 0, 50, 0}, false},
		{"wrong first argument", []int64{int64(pmhp), 100, 0, 50, 0}, false},
		{"tag-shaped numeric argument", []int64{int64(other), int64(pmhp), 1000, 0, 100, 0}, false},
		{"last descriptor wins", []int64{int64(pmhp), 1000, 0, 100, 0, int64(pmhp), 1000, 0, 50, 0}, false},
		{"last descriptor becomes exempt", []int64{int64(pmhp), 1000, 0, 50, 0, int64(pmhp), 1000, 0, 100, 0}, true},
		{"terminal stops scan", []int64{0x73736f75, int64(pmhp), 1000, 0, 100, 0}, false},
		{"terminal preserves prior descriptor", []int64{int64(pmhp), 1000, 0, 100, 0, 0x73736f75, int64(pmhp), 1000, 0, 50, 0}, true},
		{"truncated descriptor", []int64{int64(pmhp), 1000, 0, 100}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fields := make([]string, 69)
			for _, n := range tc.tail {
				fields = append(fields, strconv.FormatInt(n, 10))
			}
			if got := nativeSkillDefersCancellation(fields, arity); got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

// Optional complete retail-data regression. It exercises the actual production
// projection helpers, not a second implementation of the chain/pmhp rules.
// SRO_SKILL_TEXTDATA: verified v1.150 server/textdata directory
// SRO_SKILL_PARAM_CATALOG: client-next/src/engine/foundation/ui/skill-tooltip-catalog.ts
// SRO_SKILL_LIFECYCLE_AUDIT: optional JSON output path for offline verification
func TestRetailSkillLifecycleProjection(t *testing.T) {
	dir, catalog := os.Getenv("SRO_SKILL_TEXTDATA"), os.Getenv("SRO_SKILL_PARAM_CATALOG")
	if dir == "" || catalog == "" {
		t.Skip("set SRO_SKILL_TEXTDATA and SRO_SKILL_PARAM_CATALOG for the supplied v1.150 data")
	}
	specs, err := os.ReadFile(catalog)
	if err != nil {
		t.Fatal(err)
	}
	arities := map[uint32]int{0: 0}
	for _, match := range regexp.MustCompile(`SkillPane_ParamSpec\(\s*"([^"]+)"\s*,\s*(\d+)`).FindAllStringSubmatch(string(specs), -1) {
		var tag uint32
		for _, c := range match[1] {
			tag = tag<<8 | uint32(c)
		}
		arities[tag], _ = strconv.Atoi(match[2])
	}
	arity := func(tag uint32) int {
		if n, ok := arities[tag]; ok {
			return n
		}
		return -1
	}
	files, err := filepath.Glob(filepath.Join(dir, "skilldata_*.txt"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no skill shards: %v", err)
	}
	next := map[uint32]uint32{}
	deferred := map[uint32]bool{}
	names := map[uint32]string{}
	for _, file := range files {
		bytes, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if len(bytes) < 2 || bytes[0] != 0xff || bytes[1] != 0xfe {
			t.Fatalf("expected UTF-16LE BOM: %s", file)
		}
		words := make([]uint16, (len(bytes)-2)/2)
		for i := range words {
			words[i] = binary.LittleEndian.Uint16(bytes[2+2*i:])
		}
		for _, line := range strings.Split(string(utf16.Decode(words)), "\n") {
			fields := strings.Split(strings.TrimSuffix(line, "\r"), "\t")
			if len(fields) != 118 || fields[0] != "1" {
				continue
			}
			id64, err := strconv.ParseUint(fields[1], 10, 32)
			if err != nil {
				t.Fatal(err)
			}
			id := uint32(id64)
			link, _ := strconv.ParseUint(fields[9], 10, 32)
			next[id] = uint32(link)
			names[id] = fields[3]
			deferred[id] = nativeSkillDefersCancellation(fields, arity)
		}
	}
	links, err := nativeSkillCastLinks(next)
	if err != nil {
		t.Fatal(err)
	}
	roots := map[uint32]bool{}
	exempt := []uint32{}
	for _, root := range links {
		roots[root] = true
	}
	for id, flag := range deferred {
		if flag {
			exempt = append(exempt, id)
		}
	}
	if len(next) != 27835 || len(roots) != 1394 || len(links) != 2373 || !reflect.DeepEqual(exempt, []uint32{3032}) {
		t.Fatalf("rows=%d roots=%d linked=%d exempt=%v", len(next), len(roots), len(links), exempt)
	}
	if links[7] != 6 || links[8] != 6 {
		t.Fatalf("retail chain: %v %v", links[7], links[8])
	}
	t.Logf("27835 rows; 1394 roots; 2373 linked sub-skills; exemption only 3032 (%s)", names[3032])
	if output := os.Getenv("SRO_SKILL_LIFECYCLE_AUDIT"); output != "" {
		data, err := json.MarshalIndent(struct {
			Rows   int               `json:"rows"`
			Roots  int               `json:"roots"`
			Linked map[uint32]uint32 `json:"linkedSkillIds"`
			Exempt []uint32          `json:"cancellationDeferred"`
		}{len(next), len(roots), links, exempt}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(output, data, 0644); err != nil {
			t.Fatal(err)
		}
	}
}
