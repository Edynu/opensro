package simulation

import (
	"opensro.online/server/internal/game/world/monster"
	"testing"
)

func BenchmarkMeasuredMoverUpdate(b *testing.B) {
	for _, pending := range []bool{true, false} {
		name := "live"
		if pending {
			name = "pending"
		}
		b.Run(name, func(b *testing.B) {
			m := monster.PendingMover{Pose: monster.Pose{RegionID: 24488, X: 1, Z: 2}}.Expand()
			if !pending {
				m.DepartMs = 1
			}
			s := newMoverStorage(map[uint32]monster.MoverState{1: m})
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				m.Pose.X = float64(i)
				s.set(1, m)
			}
		})
	}
}

func BenchmarkMeasuredAcquisitionBlocks(b *testing.B) {
	p := monster.Pose{RegionID: 24488, X: 1750, Z: 100}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = acquisitionBlocks(p, 310)
	}
}

func BenchmarkMeasuredSpawnQueue(b *testing.B) {
	q := make(spawnQueue, 0, 1024)
	for i := 0; i < 1000; i++ {
		q.pushTick(spawnTick{dueMs: int64(i), group: spawnGroup{nest: i}})
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tick := q.popTick()
		tick.dueMs += 1000
		q.pushTick(tick)
	}
}
