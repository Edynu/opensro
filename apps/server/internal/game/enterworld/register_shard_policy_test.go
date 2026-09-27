package enterworld

import (
	"path/filepath"
	"runtime"
	"testing"

	"opensro.online/server/internal/domain"
)

func TestDevShardPolicyFromCatalog(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	catalogPath := filepath.Join(filepath.Dir(file), "..", "..", "..", "config", "shards.json")
	t.Setenv("SRO_SHARD_CATALOG_PATH", catalogPath)

	policy := devShardPolicyFromCatalog()
	if policy.defaultID != domain.DefaultDivisionID {
		t.Fatalf("default shard = %q, want %q", policy.defaultID, domain.DefaultDivisionID)
	}
	if len(policy.allowedIDs) < 2 {
		t.Fatalf("allowed ids = %v, want at least global-official and test", policy.allowedIDs)
	}
	resolve := DevResolveDivisionID(
		StaticCharacterSource{},
		policy.allowedIDs,
		policy.defaultID,
	)
	if got := resolve(domain.TestDivisionID); got != domain.TestDivisionID {
		t.Fatalf("resolve(test) = %q, want %q", got, domain.TestDivisionID)
	}
}
