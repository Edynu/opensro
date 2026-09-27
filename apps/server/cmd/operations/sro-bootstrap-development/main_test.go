package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadDevelopmentCredentials(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dev-account.env")
	payload := strings.Join([]string{
		"# browser login",
		"SRO_DEV_ACCOUNT_ID='tester'",
		`SRO_DEV_ACCOUNT_PASSWORD="12\t3123"`,
		"SRO_DEV_ACCOUNT_SHARD=global-official",
		"SRO_UNRELATED_SETTING=false",
		"",
	}, "\n")
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}

	credentials, err := readDevelopmentCredentials(path)
	if err != nil {
		t.Fatalf("readDevelopmentCredentials: %v", err)
	}
	if credentials.accountID != "tester" ||
		string(credentials.password) != "12\t3123" ||
		credentials.shardID != "global-official" {
		t.Fatalf("credentials = %#v", credentials)
	}
}

func TestReadDevelopmentCredentialsRefusesDuplicateOrMissingKeys(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
	}{
		{
			name: "duplicate",
			payload: strings.Join([]string{
				"SRO_DEV_ACCOUNT_ID=tester",
				"SRO_DEV_ACCOUNT_ID=other",
				"SRO_DEV_ACCOUNT_PASSWORD=123123",
				"SRO_DEV_ACCOUNT_SHARD=global-official",
			}, "\n"),
			want: "repeats SRO_DEV_ACCOUNT_ID",
		},
		{
			name: "missing password",
			payload: strings.Join([]string{
				"SRO_DEV_ACCOUNT_ID=tester",
				"SRO_DEV_ACCOUNT_SHARD=global-official",
			}, "\n"),
			want: "SRO_DEV_ACCOUNT_PASSWORD is missing or empty",
		},
		{
			name: "missing shard",
			payload: strings.Join([]string{
				"SRO_DEV_ACCOUNT_ID=tester",
				"SRO_DEV_ACCOUNT_PASSWORD=123123",
			}, "\n"),
			want: "SRO_DEV_ACCOUNT_SHARD is missing or empty",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "dev-account.env")
			if err := os.WriteFile(path, []byte(test.payload), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := readDevelopmentCredentials(path); err == nil ||
				!strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want %q", err, test.want)
			}
		})
	}
}

func TestResolvePathsHonorsBothExplicitPathsWithoutCheckout(t *testing.T) {
	stateDir := filepath.Join(t.TempDir(), "state")
	devAccount := filepath.Join(t.TempDir(), "dev-account.env")
	shardCatalog := filepath.Join(t.TempDir(), "shards.json")
	shardStateRoot := filepath.Join(t.TempDir(), "shards")

	paths, err := resolvePaths(
		stateDir,
		devAccount,
		shardCatalog,
		shardStateRoot,
	)
	if err != nil {
		t.Fatalf("resolvePaths: %v", err)
	}
	for _, path := range []string{
		paths.clusterStateDir,
		paths.devAccount,
		paths.shardCatalog,
		paths.shardStateRoot,
	} {
		if !filepath.IsAbs(path) {
			t.Fatalf("path is not absolute: %q", path)
		}
	}
	if paths.clusterStateDir != cleanAbsolute(stateDir) ||
		paths.devAccount != cleanAbsolute(devAccount) ||
		paths.shardCatalog != cleanAbsolute(shardCatalog) ||
		paths.shardStateRoot != cleanAbsolute(shardStateRoot) {
		t.Fatalf("resolved paths = %#v", paths)
	}
}
