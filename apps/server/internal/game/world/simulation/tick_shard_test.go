package simulation

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

type blockingShardPusher struct {
	mu      sync.Mutex
	seen    map[string]bool
	entered chan string
	release chan struct{}
}

func (p *blockingShardPusher) PushToSession(sessionID string, _ []Frame) {
	p.mu.Lock()
	first := !p.seen[sessionID]
	p.seen[sessionID] = true
	p.mu.Unlock()
	if !first {
		return
	}
	p.entered <- sessionID
	<-p.release
}

func (*blockingShardPusher) PushToDivision(string, []Frame, string) {}

func divisionForShard(t *testing.T, shard, shardCount int) string {
	t.Helper()
	for i := 0; i < 10_000; i++ {
		divisionID := fmt.Sprintf("division-%d", i)
		if tickShardForDivision(divisionID, shardCount) == shard {
			return divisionID
		}
	}
	t.Fatalf("could not find division for shard %d/%d", shard, shardCount)
	return ""
}

func TestTickerRunsDifferentDivisionOwnersConcurrentlyAndJoins(t *testing.T) {
	const shardCount = 2
	firstDivision := divisionForShard(t, 0, shardCount)
	secondDivision := divisionForShard(t, 1, shardCount)
	source := &fakeSource{sessions: []SessionSnapshot{
		{SessionID: "first", DivisionID: firstDivision, CharacterID: 1, NpcsEnabled: true, NpcAnchor: NpcShopSpawn()},
		{SessionID: "second", DivisionID: secondDivision, CharacterID: 2, NpcsEnabled: true, NpcAnchor: NpcShopSpawn()},
	}}
	push := &blockingShardPusher{
		seen:    make(map[string]bool),
		entered: make(chan string, 2),
		release: make(chan struct{}),
	}
	ticker := NewTicker(source, push)
	ticker.Roster = DefaultNpcRoster()
	ticker.ShardCount = shardCount
	ticker.Interval = time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	go ticker.Run(ctx)

	for i := 0; i < 2; i++ {
		select {
		case <-push.entered:
		case <-time.After(time.Second):
			t.Fatal("different division owners did not enter concurrently")
		}
	}

	cancel()
	select {
	case <-ticker.Done():
		t.Fatal("ticker reported stopped while shard work was still running")
	case <-time.After(20 * time.Millisecond):
	}

	close(push.release)
	select {
	case <-ticker.Done():
	case <-time.After(time.Second):
		t.Fatal("ticker did not join shard workers after cancellation")
	}
}

func TestTickShardAssignmentIsStable(t *testing.T) {
	for _, divisionID := range []string{"global-official", "alpha", "beta", ""} {
		first := tickShardForDivision(divisionID, 7)
		for i := 0; i < 100; i++ {
			if got := tickShardForDivision(divisionID, 7); got != first {
				t.Fatalf("assignment for %q changed from %d to %d", divisionID, first, got)
			}
		}
	}
}
