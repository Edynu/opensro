// Command sro-init creates one empty authority for a configured shard.
package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"opensro.online/server/internal/cluster/shard"
	"opensro.online/server/internal/data/store"
)

func main() {
	shardID := flag.String(
		"shard",
		"",
		"required shard id from the configured shard catalog",
	)
	authorityDir := flag.String(
		"authority-dir",
		"",
		"directory for the new authority database (default .state/shards/<shard>/authority)",
	)
	flag.Parse()

	target, err := resolveAuthorityTarget(*shardID, *authorityDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sro-init: %v\n", err)
		os.Exit(2)
	}
	if err := store.Initialize(target); err != nil {
		fmt.Fprintf(os.Stderr, "sro-init: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf(
		"initialized shard %q authority database at %s\n",
		strings.TrimSpace(*shardID),
		target,
	)
}

func resolveAuthorityTarget(shardID, override string) (string, error) {
	shardID = strings.TrimSpace(shardID)
	if shardID == "" {
		return "", fmt.Errorf("-shard is required")
	}
	catalog, path, err := shard.LoadFromEnv()
	if err != nil {
		return "", fmt.Errorf("load shard catalog %s: %w", path, err)
	}
	if _, ok := catalog.Resolve(shardID); !ok {
		return "", fmt.Errorf("shard %q is not present in catalog %s", shardID, path)
	}
	if override = strings.TrimSpace(override); override != "" {
		return override, nil
	}
	return store.DirForShardFromEnv(shardID), nil
}
