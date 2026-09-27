package clusterprovision

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"opensro.online/server/internal/cluster/shard"
	"opensro.online/server/internal/data/store"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/security/auth"
)

func TestEnsureIdentityCreatesThenPreservesKeyRing(t *testing.T) {
	stateDir := t.TempDir()

	created, err := EnsureIdentity(stateDir)
	if err != nil {
		t.Fatalf("EnsureIdentity(create): %v", err)
	}
	if !created.Created {
		t.Fatal("identity was not reported created")
	}
	before, err := os.ReadFile(created.Path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.PublicAgentSessionKeyRing(before); err != nil {
		t.Fatal(err)
	}
	preserved, err := EnsureIdentity(stateDir)
	if err != nil {
		t.Fatalf("EnsureIdentity(preserve): %v", err)
	}
	if preserved.Created {
		t.Fatal("identity was unexpectedly replaced")
	}
	after, err := os.ReadFile(preserved.Path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("identity changed on idempotent rerun")
	}
}

func TestEnsureIdentityRefusesInvalidExistingRing(t *testing.T) {
	stateDir := t.TempDir()
	path := filepath.Join(stateDir, auth.AgentSessionPrivateKeyRingFile)
	if err := os.WriteFile(path, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := EnsureIdentity(stateDir); err == nil {
		t.Fatal("invalid existing identity was accepted")
	}
}

func TestEnsureDevelopmentAccountCreatesAndValidatesMatchingCatalog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.json")
	password := []byte("123123")

	result, err := EnsureDevelopmentAccount(path, "tester", password)
	if err != nil {
		t.Fatalf("EnsureDevelopmentAccount(create): %v", err)
	}
	if !result.Created {
		t.Fatal("account catalog was not reported created")
	}
	catalog, err := auth.Load(path)
	if err != nil {
		t.Fatalf("auth.Load: %v", err)
	}
	hash, found := catalog.PasswordHash("tester")
	if !found {
		t.Fatal("tester account is missing")
	}
	if err := bcrypt.CompareHashAndPassword(hash, password); err != nil {
		t.Fatalf("created hash does not authenticate: %v", err)
	}

	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err = EnsureDevelopmentAccount(path, "tester", password)
	if err != nil {
		t.Fatalf("EnsureDevelopmentAccount(validate): %v", err)
	}
	if result.Created {
		t.Fatal("matching account catalog was unexpectedly replaced")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("matching account catalog changed on rerun")
	}
}

func TestEnsureDevelopmentAccountRefusesCredentialDrift(t *testing.T) {
	path := filepath.Join(t.TempDir(), "accounts.json")
	if _, err := EnsureDevelopmentAccount(path, "tester", []byte("123123")); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := EnsureDevelopmentAccount(
		path,
		"tester",
		[]byte("different"),
	); err == nil || !strings.Contains(err.Error(), "different password") {
		t.Fatalf("password drift error = %v", err)
	}
	if _, err := EnsureDevelopmentAccount(
		path,
		"another",
		[]byte("123123"),
	); err == nil || !strings.Contains(err.Error(), "does not contain") {
		t.Fatalf("account drift error = %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("credential drift replaced the existing account catalog")
	}
}

func TestEnsureDevelopmentShardsCreatesEnabledAuthoritiesThenValidatesThem(t *testing.T) {
	catalog, err := shard.NewCatalog([]shard.Definition{
		developmentShardDefinition("global-official", 1, true, true),
		developmentShardDefinition("test", 2, false, true),
		developmentShardDefinition("disabled", 3, false, false),
	})
	if err != nil {
		t.Fatal(err)
	}
	stateRoot := t.TempDir()

	created, err := EnsureDevelopmentShards(catalog, stateRoot)
	if err != nil {
		t.Fatalf("EnsureDevelopmentShards(create): %v", err)
	}
	if len(created) != 2 {
		t.Fatalf("created %d shard authorities, want 2", len(created))
	}
	for _, result := range created {
		if !result.Created {
			t.Fatalf("%s was not reported created", result.Path)
		}
		if info, err := os.Stat(result.Path); err != nil || !info.Mode().IsRegular() {
			t.Fatalf("created database %s is unavailable: %v", result.Path, err)
		}
	}
	disabledPath := filepath.Join(
		stateRoot,
		"disabled",
		"authority",
		store.DBFileName,
	)
	if _, err := os.Stat(disabledPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("disabled shard database exists or stat failed unexpectedly: %v", err)
	}

	preserved, err := EnsureDevelopmentShards(catalog, stateRoot)
	if err != nil {
		t.Fatalf("EnsureDevelopmentShards(validate): %v", err)
	}
	for _, result := range preserved {
		if result.Created {
			t.Fatalf("%s was unexpectedly recreated", result.Path)
		}
	}
}

func TestEnsureDevelopmentShardsRefusesForeignShardState(t *testing.T) {
	catalog, err := shard.NewCatalog([]shard.Definition{
		developmentShardDefinition("global-official", 1, true, true),
	})
	if err != nil {
		t.Fatal(err)
	}
	stateRoot := t.TempDir()
	if _, err := EnsureDevelopmentShards(catalog, stateRoot); err != nil {
		t.Fatal(err)
	}
	authorityDir := filepath.Join(stateRoot, "global-official", "authority")
	authority, err := store.Open(
		authorityDir,
		store.Options{
			RequireStore: true,
			DefaultSkills: func(string, []uint32) ([]uint32, error) {
				return []uint32{1}, nil
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := authority.CreateCharacter(
		"foreign",
		"tester",
		&enterworld.Character{Name: "Foreign"},
	); err != nil {
		authority.Close()
		t.Fatal(err)
	}
	authority.Close()

	if _, err := EnsureDevelopmentShards(catalog, stateRoot); err == nil ||
		!strings.Contains(err.Error(), "foreign") {
		t.Fatalf("foreign-shard validation error = %v", err)
	}
}

func developmentShardDefinition(
	id string,
	nativeID uint16,
	defaultShard bool,
	enabled bool,
) shard.Definition {
	return shard.Definition{
		ID:             id,
		Name:           id,
		NativeServerID: nativeID,
		Capacity:       100,
		Default:        defaultShard,
		Enabled:        enabled,
		ControlURL:     "http://127.0.0.1:9001",
		TransportURL:   "http://127.0.0.1:9002",
	}
}
