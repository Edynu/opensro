// Package commerce owns merchandise admission. Action owns live transactions.
package commerce

import (
	"fmt"
	"opensro.online/server/internal/game/enterworld"
	"os"
	"path/filepath"
	"strconv"
)

type Content struct {
	Ref      *enterworld.ItemRef
	Stack    uint16
	Plus     uint8
	Variance uint64
	Data     uint32
	Magic    []uint64
}

type Offer struct {
	Slot     uint8
	Ref      *enterworld.ItemRef
	Price    uint64
	Stack    uint16
	Contents []Content
}
type Catalog struct {
	Tabs  map[int32][]Offer
	Magic enterworld.MagicOptionSource
}

// Load admits authored gold packages and preserves every item template.
// Conditional and multi-currency policies still require their own authorities.
func Load(dir string, refs enterworld.ItemRefSource) (*Catalog, error) {
	tables := map[string][][]string{}
	for _, name := range []string{"refshoptab", "refshopgoods", "refscrapofpackageitem", "refpricepolicyofitem", "refconditiontosellpackageitem", "refrewardpolicytosellpackageitem"} {
		path := filepath.Join(dir, name+".txt")
		rows := enterworld.ReadTextdataFile(path)
		info, err := os.Stat(path)
		if err != nil || rows == nil && info.Size() > 2 {
			return nil, fmt.Errorf("commerce: missing %s", name)
		}
		tables[name] = rows
	}
	c := &Catalog{Tabs: map[int32][]Offer{}, Magic: enterworld.NewTextdataMagicOptions(dir)}
	tabIDs := map[string]int32{}
	for _, r := range tables["refshoptab"] {
		if len(r) >= 6 && r[0] == "1" {
			n, e := strconv.ParseInt(r[2], 10, 32)
			if e != nil {
				return nil, e
			}
			tabIDs[r[3]] = int32(n)
		}
	}
	blocked := map[string]bool{}
	for _, name := range []string{"refconditiontosellpackageitem", "refrewardpolicytosellpackageitem"} {
		for _, r := range tables[name] {
			if len(r) > 2 && r[0] == "1" {
				blocked[r[2]] = true
			}
		}
	}
	prices := map[string]uint64{}
	for _, r := range tables["refpricepolicyofitem"] {
		if len(r) < 5 || r[0] != "1" {
			continue
		}
		n, e := strconv.ParseUint(r[4], 10, 32)
		if e != nil || r[3] != "1" || n == 0 || prices[r[2]] != 0 {
			blocked[r[2]] = true
		}
		prices[r[2]] = n
	}
	scraps := map[string][][]string{}
	for _, r := range tables["refscrapofpackageitem"] {
		if len(r) < 20 || r[0] != "1" {
			continue
		}
		scraps[r[2]] = append(scraps[r[2]], r)
	}
	seen := map[string]bool{}
	for _, r := range tables["refshopgoods"] {
		if len(r) < 5 || r[0] != "1" {
			continue
		}
		tab, ok := tabIDs[r[2]]
		if !ok {
			return nil, fmt.Errorf("commerce: missing tab %s", r[2])
		}
		slot, e := strconv.ParseUint(r[4], 10, 8)
		if e != nil {
			return nil, e
		}
		key := r[2] + ":" + r[4]
		if seen[key] {
			return nil, fmt.Errorf("commerce: duplicate slot %s", key)
		}
		seen[key] = true
		rows := scraps[r[3]]
		if blocked[r[3]] || len(rows) == 0 || prices[r[3]] == 0 || refs == nil {
			continue
		}
		contents := []Content{}
		valid := true
		for _, scrap := range rows {
			ref, ok := refs.ItemRefByCodename(scrap[3])
			if !ok || ref == nil || ref.TypeIDs[0] != 3 || (ref.TypeIDs[1] != 1 && ref.TypeIDs[1] != 3) || ref.TypeIDs[1] == 3 && (ref.TypeIDs[2] == 5 || ref.TypeIDs[2] == 8) {
				valid = false
				break
			}
			plus, e1 := strconv.ParseUint(scrap[4], 10, 8)
			variance, e2 := strconv.ParseUint(scrap[5], 10, 64)
			data, e3 := strconv.ParseUint(scrap[6], 10, 32)
			count, e4 := strconv.ParseUint(scrap[7], 10, 8)
			if e1 != nil || e2 != nil || e3 != nil || e4 != nil || count > 12 {
				valid = false
				break
			}
			magic := []uint64{}
			for i := 0; i < 12; i++ {
				n, e := strconv.ParseUint(scrap[8+i], 10, 64)
				if e != nil || i >= int(count) && n != 0 {
					valid = false
					break
				}
				if i < int(count) {
					magic = append(magic, n)
				}
			}
			if !valid {
				break
			}
			stack := uint16(1)
			if ref.TypeIDs[1] == 3 {
				max := ref.NativeFields.Get("maxStack")
				if max < 1 || max > 65535 || max != float64(uint16(max)) || data > 65535 || plus != 0 || variance != 0 || count != 0 {
					valid = false
					break
				}
				stack = uint16(max)
			} else if data == 0 {
				if ref.VarianceIntMin1c0 == nil || *ref.VarianceIntMin1c0 < 0 || *ref.VarianceIntMin1c0 > 0xffffffff {
					valid = false
					break
				}
				data = uint64(*ref.VarianceIntMin1c0)
			}
			contents = append(contents, Content{Ref: ref, Stack: stack, Plus: uint8(plus), Variance: variance, Data: uint32(data), Magic: magic})
		}
		if !valid || len(contents) == 0 || len(contents) > 96 {
			continue
		}
		first := contents[0]
		c.Tabs[tab] = append(c.Tabs[tab], Offer{Slot: uint8(slot), Ref: first.Ref, Price: prices[r[3]], Stack: first.Stack, Contents: contents})

	}
	return c, nil
}
