package shard

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDirectoryLeaseOwnershipAndExpiry(t *testing.T) {
	catalog, err := NewCatalog([]Definition{testDefinition("alpha", 1, true)})
	if err != nil {
		t.Fatal(err)
	}
	definition := catalog.Default()
	definition.Capacity = 1000
	catalog, err = NewCatalog([]Definition{definition})
	if err != nil {
		t.Fatal(err)
	}
	directory, err := NewDirectory(catalog, 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1000, 0)

	if got := directory.Snapshot(now)[0]; got.Operating || got.OnlinePlayers != 0 {
		t.Fatalf("unleased status = %+v", got)
	}
	if err := directory.Publish(Heartbeat{
		ShardID: "alpha", InstanceID: "boot-a", Sequence: 1, OnlinePlayers: 700,
	}, now); err != nil {
		t.Fatal(err)
	}
	if got := directory.Snapshot(now)[0]; !got.Operating || got.OnlinePlayers != 700 {
		t.Fatalf("live status = %+v", got)
	}
	if err := directory.Publish(Heartbeat{
		ShardID: "alpha", InstanceID: "boot-b", Sequence: 1, OnlinePlayers: 1,
	}, now.Add(time.Second)); !errors.Is(err, ErrShardAlreadyOwned) {
		t.Fatalf("split-brain publish = %v", err)
	}
	if err := directory.Publish(Heartbeat{
		ShardID: "alpha", InstanceID: "boot-a", Sequence: 1, OnlinePlayers: 701,
	}, now.Add(time.Second)); !errors.Is(err, ErrStaleHeartbeat) {
		t.Fatalf("stale publish = %v", err)
	}
	if got := directory.Snapshot(now.Add(10 * time.Second))[0]; got.Operating || got.OnlinePlayers != 0 {
		t.Fatalf("expired status = %+v", got)
	}
	if err := directory.Publish(Heartbeat{
		ShardID: "alpha", InstanceID: "boot-b", Sequence: 1, OnlinePlayers: 5,
	}, now.Add(10*time.Second)); err != nil {
		t.Fatalf("takeover after expiry: %v", err)
	}
	if err := directory.Release("alpha", "boot-a"); !errors.Is(err, ErrLeaseNotOwned) {
		t.Fatalf("foreign release = %v", err)
	}
	if err := directory.Release("alpha", "boot-b"); err != nil {
		t.Fatalf("owner release: %v", err)
	}
	if got := directory.Snapshot(now.Add(10 * time.Second))[0]; got.Operating {
		t.Fatalf("released shard still operating: %+v", got)
	}
}

func TestPersistentDirectoryPreservesOwnerAcrossAgentRestart(t *testing.T) {
	catalog, err := NewCatalog([]Definition{testDefinition("alpha", 1, true)})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "shard-leases.json")
	first, err := NewPersistentDirectory(catalog, 10*time.Second, path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1000, 0)
	if err := first.Publish(Heartbeat{
		ShardID:       "alpha",
		InstanceID:    "boot-a",
		Sequence:      7,
		OnlinePlayers: 1,
	}, now); err != nil {
		t.Fatal(err)
	}

	restarted, err := NewPersistentDirectory(catalog, 10*time.Second, path)
	if err != nil {
		t.Fatal(err)
	}
	status := restarted.Snapshot(now.Add(time.Second))[0]
	if !status.Operating || status.OnlinePlayers != 1 {
		t.Fatalf("restored status = %+v", status)
	}
	if err := restarted.Publish(Heartbeat{
		ShardID:       "alpha",
		InstanceID:    "boot-b",
		Sequence:      1,
		OnlinePlayers: 0,
	}, now.Add(time.Second)); !errors.Is(err, ErrShardAlreadyOwned) {
		t.Fatalf("post-restart split brain = %v", err)
	}
	if err := restarted.Publish(Heartbeat{
		ShardID:       "alpha",
		InstanceID:    "boot-a",
		Sequence:      8,
		OnlinePlayers: 1,
	}, now.Add(time.Second)); err != nil {
		t.Fatalf("owner renewal after Agent restart: %v", err)
	}
}

func TestPersistentDirectoryRefusesMalformedState(t *testing.T) {
	catalog, err := NewCatalog([]Definition{testDefinition("alpha", 1, true)})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "shard-leases.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"unknown":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewPersistentDirectory(catalog, time.Second, path); err == nil {
		t.Fatal("malformed persisted shard directory was accepted")
	}
}
