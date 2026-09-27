// The account catalog is the global login credential authority.
package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"

	"golang.org/x/crypto/bcrypt"
	"opensro.online/server/internal/domain"
)

const (
	MaxFileBytes  int64 = 1 << 20
	MaxBcryptCost       = 12
)

// Catalog is an immutable account-id to bcrypt-hash index.
type Catalog struct {
	hashes map[string][]byte
}

// Load reads a strict regular-file account catalog. Symlinks and file swaps
// are refused because this file is the global login authority.
func Load(path string) (*Catalog, error) {
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !pathInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file (symlinks are not accepted)")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || !os.SameFile(pathInfo, info) {
		return nil, fmt.Errorf("account file changed while opening")
	}
	if info.Size() > MaxFileBytes {
		return nil, fmt.Errorf("file is %d bytes, limit is %d", info.Size(), MaxFileBytes)
	}
	payload, err := io.ReadAll(io.LimitReader(file, MaxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(payload)) > MaxFileBytes {
		return nil, fmt.Errorf("file grew past %d bytes while reading", MaxFileBytes)
	}

	var rows []struct {
		ID           string `json:"id"`
		PasswordHash string `json:"passwordHash"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&rows); err != nil {
		return nil, err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return nil, fmt.Errorf("multiple JSON values")
		}
		return nil, fmt.Errorf("trailing JSON: %w", err)
	}

	hashes := make(map[string][]byte, len(rows))
	for _, row := range rows {
		if !domain.AccountIDValid(row.ID) {
			return nil, fmt.Errorf("account id %q is invalid", row.ID)
		}
		if row.ID == domain.ReservedAccountID {
			return nil, fmt.Errorf("account id %q is reserved", row.ID)
		}
		if _, duplicate := hashes[row.ID]; duplicate {
			return nil, fmt.Errorf("duplicate account id %q", row.ID)
		}
		hash := []byte(row.PasswordHash)
		cost, err := bcrypt.Cost(hash)
		if err != nil {
			return nil, fmt.Errorf("account %q has invalid bcrypt passwordHash: %w", row.ID, err)
		}
		if cost < bcrypt.DefaultCost || cost > MaxBcryptCost {
			return nil, fmt.Errorf(
				"account %q bcrypt cost %d is outside %d..%d",
				row.ID,
				cost,
				bcrypt.DefaultCost,
				MaxBcryptCost,
			)
		}
		hashes[row.ID] = append([]byte(nil), hash...)
	}
	if len(hashes) == 0 {
		return nil, fmt.Errorf("no accounts in file")
	}
	return &Catalog{hashes: hashes}, nil
}

// PasswordHash returns a detached bcrypt hash for login comparison.
func (catalog *Catalog) PasswordHash(accountID string) ([]byte, bool) {
	if catalog == nil {
		return nil, false
	}
	hash, ok := catalog.hashes[accountID]
	return append([]byte(nil), hash...), ok
}

// IDs returns detached account IDs for shard-state audits.
func (catalog *Catalog) IDs() []string {
	if catalog == nil {
		return nil
	}
	ids := make([]string, 0, len(catalog.hashes))
	for id := range catalog.hashes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// Len returns the number of configured global accounts.
func (catalog *Catalog) Len() int {
	if catalog == nil {
		return 0
	}
	return len(catalog.hashes)
}
