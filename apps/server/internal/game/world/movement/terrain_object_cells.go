package movement

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"math"
)

// Terrain cells own outside-object candidate admission, native 404510/428300.
func admitTerrainObjectCells(region navmeshRegion, rows []objectNavPlacement) error {
	c := region.Cells
	if c.ObjectIndexOffsets == "" {
		return nil
	}
	count, ok := jsonInt(c.Count)
	if !ok || count < 0 || count > 65536 {
		return fmt.Errorf("invalid terrain cell count")
	}
	column := func(s string, n int) ([]byte, error) {
		b, e := base64.StdEncoding.DecodeString(s)
		if e != nil || len(b) != n {
			return nil, fmt.Errorf("invalid terrain cell column")
		}
		return b, nil
	}
	offsets, e := column(c.ObjectIndexOffsets, (count+1)*4)
	if e != nil {
		return e
	}
	length := int(binary.LittleEndian.Uint32(offsets[count*4:]))
	if length > 1048576 || binary.LittleEndian.Uint32(offsets) != 0 {
		return fmt.Errorf("invalid terrain cell offsets")
	}
	ids, e := column(c.ObjectIndices, length*2)
	if e != nil {
		return e
	}
	var cols [4][]byte
	for i, s := range []string{c.MinX, c.MinZ, c.MaxX, c.MaxZ} {
		cols[i], e = column(s, count*4)
		if e != nil {
			return e
		}
	}
	cells := make([][][4]float32, len(rows))
	for i := range rows {
		rows[i].terrainCells = &cells[i]
	}
	for i := 0; i < count; i++ {
		a, b := int(binary.LittleEndian.Uint32(offsets[i*4:])), int(binary.LittleEndian.Uint32(offsets[(i+1)*4:]))
		if a > b || b > length {
			return fmt.Errorf("invalid terrain cell offsets")
		}
		var r [4]float32
		for j := range r {
			r[j] = math.Float32frombits(binary.LittleEndian.Uint32(cols[j][i*4:]))
			if math.IsNaN(float64(r[j])) || math.IsInf(float64(r[j]), 0) {
				return fmt.Errorf("invalid terrain cell bounds")
			}
		}
		if r[0] > r[2] || r[1] > r[3] {
			return fmt.Errorf("invalid terrain cell bounds")
		}
		for j := a; j < b; j++ {
			id := int(binary.LittleEndian.Uint16(ids[j*2:]))
			if id >= len(rows) {
				return fmt.Errorf("invalid terrain object reference")
			}
			cells[id] = append(cells[id], r)
		}
	}
	return nil
}
