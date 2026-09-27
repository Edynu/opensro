package auth

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestLoadStrictAccountCatalog(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("secret"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "accounts.json")
	payload := `[{"id":"account-a","passwordHash":"` + string(hash) + `"}]`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := catalog.PasswordHash("account-a")
	if !ok || string(got) != string(hash) {
		t.Fatalf("hash = %q, %v", got, ok)
	}
	got[0] ^= 0xff
	again, _ := catalog.PasswordHash("account-a")
	if string(got) == string(again) {
		t.Fatal("caller mutated catalog hash")
	}
}
