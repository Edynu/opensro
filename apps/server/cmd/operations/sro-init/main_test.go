package main

import (
	"os"
	"path/filepath"
	"testing"

	"opensro.online/server/internal/cluster/shard"
	"opensro.online/server/internal/data/store"
)

func TestResolveAuthorityTargetRequiresCatalogShard(t *testing.T) {
	catalogPath := filepath.Join(t.TempDir(), "shards.json")
	const catalog = `{"shards":[{
		"id":"alpha",
		"name":"Alpha",
		"nativeServerId":1,
		"nativeFarmId":0,
		"capacity":100,
		"default":true,
		"test":false,
		"enabled":true,
		"controlUrl":"http://127.0.0.1:9001",
		"transportUrl":"http://127.0.0.1:9002"
	}]}`
	if err := os.WriteFile(catalogPath, []byte(catalog), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(shard.EnvCatalogPath, catalogPath)
	t.Setenv(store.EnvStateDir, "")

	if _, err := resolveAuthorityTarget("", "somewhere"); err == nil {
		t.Fatal("missing shard id was accepted")
	}
	if _, err := resolveAuthorityTarget("unknown", "somewhere"); err == nil {
		t.Fatal("unknown shard id was accepted")
	}

	target, err := resolveAuthorityTarget("alpha", "")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(".state", "shards", "alpha", "authority")
	if target != want {
		t.Fatalf("target = %q, want %q", target, want)
	}

	const mounted = "X:/mounted/alpha"
	target, err = resolveAuthorityTarget("alpha", mounted)
	if err != nil {
		t.Fatal(err)
	}
	if target != mounted {
		t.Fatalf("override target = %q, want %q", target, mounted)
	}
}
