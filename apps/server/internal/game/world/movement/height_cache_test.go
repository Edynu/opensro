package movement

import (
	"math"
	"os"
	"testing"
)

func TestBoundedHeightCacheExactAfterEviction(t *testing.T) {
	preloaded := &heightGrid{axisVertices: 2, heights: []float32{1, 2, 3, 4}}
	v := &WaterValidator{surfaces: map[string]*groundSurface{
		"loaded": {heightsByOffset: map[int64]*heightGrid{0: preloaded}}, "missing": nil,
	}}
	if err := v.EnableBoundedHeightCache(2 * heightPageBytes); err != nil {
		t.Fatal(err)
	}
	defer v.Close()
	c := v.heightCache
	if a, b, d, e := preloaded.quad(0, 0); a != 1 || b != 2 || d != 3 || e != 4 || preloaded.heights != nil {
		t.Fatal("preloaded terrain not migrated")
	}
	name := c.file.Name()
	values := make([]float32, 97*97)
	for i := range values {
		values[i] = float32(math.Sin(float64(i)) * 12345)
	}
	offset := c.store(values)
	direct := heightGrid{axisVertices: 97, heights: values}
	cached := heightGrid{axisVertices: 97, cache: c, offset: offset}
	for pass := 0; pass < 2; pass++ {
		for z := 0; z < 96; z++ {
			for x := 0; x < 96; x++ {
				a, b, d, e := direct.quad(x, z)
				aa, bb, dd, ee := cached.quad(x, z)
				if a != aa || b != bb || d != dd || e != ee {
					t.Fatalf("height changed at %d,%d", x, z)
				}
				if len(c.pages) > 2 || c.lru.Len() > 2 {
					t.Fatal("cache exceeded budget")
				}
			}
		}
	}
	if c.misses < 4 || c.hits == 0 {
		t.Fatal("eviction and hits not exercised")
	}
	if err := v.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("backing file retained")
	}
	if err := v.Close(); err != nil {
		t.Fatal(err)
	}
}
