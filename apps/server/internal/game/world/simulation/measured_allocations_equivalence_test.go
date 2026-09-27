package simulation

import (
	"container/heap"
	"math/rand"
	worldgeom "opensro.online/server/internal/game/world"
	"opensro.online/server/internal/game/world/monster"
	"testing"
)

func TestTypedSpawnHeapMatchesStandardHeap(t *testing.T) {
	r := rand.New(rand.NewSource(124))
	var reference, got spawnQueue
	for i := 0; i < 10000; i++ {
		if len(reference) == 0 || r.Intn(3) != 0 {
			row := spawnTick{dueMs: int64(r.Intn(100)), group: spawnGroup{hive: []string{"", "a", "z"}[r.Intn(3)], nest: r.Intn(100)}}
			heap.Push(&reference, row)
			got.pushTick(row)
		} else if want := heap.Pop(&reference).(spawnTick); got.popTick() != want {
			t.Fatal("ordering diverged")
		}
	}
	for len(reference) > 0 {
		if got.popTick() != heap.Pop(&reference).(spawnTick) {
			t.Fatal("drain order diverged")
		}
	}
	if len(got) != 0 {
		t.Fatal("queue retained entries")
	}
}

func TestAcquisitionFixedSetMatchesMap(t *testing.T) {
	r := rand.New(rand.NewSource(991))
	for i := 0; i < 10000; i++ {
		p := monster.Pose{RegionID: uint16(r.Uint32()), X: r.Float64()*4000 - 2000, Z: r.Float64()*4000 - 2000}
		sight := uint32(r.Intn(1921))
		radius := float32(sight)
		if radius < 1 {
			radius = 1
		}
		if radius > 310 {
			radius = 310
		}
		x0, z0 := float32(p.X)-radius, float32(p.Z)-radius
		want := map[worldgeom.InterestBlock]int{}
		for z := 0; z < 3; z++ {
			for x := 0; x < 3; x++ {
				block := worldgeom.InterestBlockAt(worldgeom.RegionXZ{RegionID: p.RegionID, X: float64(float32(float64(x0) + float64(x)*float64(radius))), Z: float64(float32(float64(z0) + float64(z)*float64(radius)))})
				if _, ok := want[block]; !ok {
					want[block] = len(want)
				}
			}
		}
		got := acquisitionBlocks(p, sight)
		if got.count != len(want) {
			t.Fatal("block count changed")
		}
		for block, ordinal := range want {
			if index, ok := got.order(block); !ok || index != ordinal {
				t.Fatal("native visitation order changed")
			}
		}
	}
}
