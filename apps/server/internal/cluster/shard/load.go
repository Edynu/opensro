package shard

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

const (
	EnvCatalogPath     = "SRO_SHARD_CATALOG_PATH"
	DefaultCatalogPath = "config/shards.json"
	maxCatalogBytes    = 64 << 10
)

type catalogDocument struct {
	Shards []Definition `json:"shards"`
}

// LoadFromEnv loads the required process shard catalog. The repository ships
// a development catalog at DefaultCatalogPath; deployments point the env var
// at their owned configuration file.
func LoadFromEnv() (*Catalog, string, error) {
	path := strings.TrimSpace(os.Getenv(EnvCatalogPath))
	if path == "" {
		path = DefaultCatalogPath
	}
	catalog, err := Load(path)
	if err != nil {
		return nil, path, err
	}
	return catalog, path, nil
}

// Load decodes one strict catalog document.
func Load(path string) (*Catalog, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open shard catalog: %w", err)
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, maxCatalogBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read shard catalog: %w", err)
	}
	if len(raw) > maxCatalogBytes {
		return nil, fmt.Errorf("shard catalog exceeds %d bytes", maxCatalogBytes)
	}

	var document catalogDocument
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		return nil, fmt.Errorf("decode shard catalog: %w", err)
	}
	if err := rejectTrailingJSON(decoder); err != nil {
		return nil, err
	}
	catalog, err := NewCatalog(document.Shards)
	if err != nil {
		return nil, fmt.Errorf("validate shard catalog: %w", err)
	}
	return catalog, nil
}

func rejectTrailingJSON(decoder *json.Decoder) error {
	var trailing any
	err := decoder.Decode(&trailing)
	if err == io.EOF {
		return nil
	}
	if err == nil {
		return fmt.Errorf("decode shard catalog: multiple JSON values")
	}
	return fmt.Errorf("decode shard catalog trailing data: %w", err)
}
