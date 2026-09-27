package monster

import "testing"

func TestCompactSpawnMoverPreservesDeadlineAndState(t *testing.T) {
	m := NewSpawnMover(Instance{Spawn: SpawnPoint{RegionID: 0x6060, X: 123.25, Y: -4.5, Z: 678.75}, SpawnHeading: 234}, 98765)
	p, ok := m.PendingSnapshot()
	if !ok || p.Expand() != m {
		t.Fatal("spawn compaction changed authoritative state")
	}
	m.DepartMs = 1
	if _, ok := m.PendingSnapshot(); ok {
		t.Fatal("moving actor compacted")
	}
}
