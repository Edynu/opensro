package movement

import (
	"container/list"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"sync"
)

const heightPageBytes = 512

type heightPage struct {
	offset int64
	data   [heightPageBytes]byte
}

// heightCache owns a private immutable backing file and a bounded page LRU.
// Unlike the source JSON, eviction never reparses or revalidates an asset.
// Published offsets remain valid until the application drains and closes us.
type heightCache struct {
	mu           sync.Mutex
	file         *os.File
	next         int64
	limit        int
	pages        map[int64]*list.Element
	lru          list.List
	hits, misses uint64
}

// EnableBoundedHeightCache is called once by composition before concurrent queries.
// Startup may have already validated spawn surfaces; migrate those too.
// The cache holds at most bytes of height payload; no terrain data is culled.
func (v *WaterValidator) EnableBoundedHeightCache(bytes int) error {
	if bytes < heightPageBytes {
		return fmt.Errorf("height cache budget too small")
	}
	if v.heightCache != nil {
		return fmt.Errorf("height cache already installed")
	}
	f, err := os.CreateTemp("", "sro-height-*.bin")
	if err != nil {
		return err
	}
	v.heightCache = &heightCache{file: f, limit: bytes / heightPageBytes, pages: make(map[int64]*list.Element)}
	for _, surface := range v.surfaces {
		if surface == nil {
			continue
		}
		for _, grid := range surface.heightsByOffset {
			if grid.cache == nil {
				grid.offset = v.heightCache.store(grid.heights)
				grid.cache = v.heightCache
				grid.heights = nil
			}
		}
	}
	return nil
}

func (v *WaterValidator) Close() error {
	if v.heightCache == nil {
		return nil
	}
	c := v.heightCache
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.file == nil {
		return nil
	}
	name := c.file.Name()
	err := c.file.Close()
	c.file = nil
	c.pages = nil
	c.lru.Init()
	if removeErr := os.Remove(name); err == nil {
		err = removeErr
	}
	return err
}

func (c *heightCache) store(values []float32) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := (len(values)*4 + heightPageBytes - 1) / heightPageBytes * heightPageBytes
	data := make([]byte, n)
	for i, v := range values {
		binary.LittleEndian.PutUint32(data[i*4:], math.Float32bits(v))
	}
	offset := c.next
	if written, err := c.file.WriteAt(data, offset); err != nil || written != len(data) {
		panic(fmt.Sprintf("terrain height backing write failed: %v", err))
	}
	c.next += int64(n)
	return offset
}

func (c *heightCache) value(offset int64) float32 {
	base := offset / int64(heightPageBytes) * int64(heightPageBytes)
	e := c.pages[base]
	if e == nil {
		c.misses++
		var page *heightPage
		if len(c.pages) == c.limit {
			e = c.lru.Back()
			page = e.Value.(*heightPage)
			delete(c.pages, page.offset)
		} else {
			page = &heightPage{}
			e = c.lru.PushFront(page)
		}
		page.offset = base
		if _, err := c.file.ReadAt(page.data[:], base); err != nil {
			panic(fmt.Sprintf("terrain height backing read failed: %v", err))
		}
		c.pages[base] = e
	} else {
		c.hits++
	}
	c.lru.MoveToFront(e)
	return math.Float32frombits(binary.LittleEndian.Uint32(e.Value.(*heightPage).data[offset-base:]))
}

func (g *heightGrid) quad(x, z int) (float64, float64, float64, float64) {
	i := z*g.axisVertices + x
	if g.cache == nil {
		return float64(g.heights[i]), float64(g.heights[i+1]), float64(g.heights[i+g.axisVertices]), float64(g.heights[i+g.axisVertices+1])
	}
	c := g.cache
	c.mu.Lock()
	defer c.mu.Unlock()
	at := func(index int) float64 { return float64(c.value(g.offset + int64(index)*4)) }
	return at(i), at(i + 1), at(i + g.axisVertices), at(i + g.axisVertices + 1)
}
