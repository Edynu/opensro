package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testSessionKeys(t *testing.T) (string, ed25519.PrivateKey, map[string]ed25519.PublicKey) {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keyID := sessionKeyID(publicKey)
	return keyID, privateKey, map[string]ed25519.PublicKey{
		keyID: publicKey,
	}
}

func TestAgentSessionBindsAccountShardAndKey(t *testing.T) {
	keyID, privateKey, publicKeys := testSessionKeys(t)
	now := time.Unix(1_800_000_000, 0)
	token, err := MintAgentSession(
		keyID,
		privateKey,
		"account-a",
		"global-official",
		now.Add(AgentSessionLifetime),
	)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := VerifyAgentSession(publicKeys, token, now)
	if err != nil {
		t.Fatal(err)
	}
	if claims.AccountID != "account-a" || claims.ShardID != "global-official" {
		t.Fatalf("claims = %+v", claims)
	}

	parts := strings.Split(token, ".")
	parts[4] = "dGVzdA"
	if _, err := VerifyAgentSession(
		publicKeys,
		strings.Join(parts, "."),
		now,
	); !errors.Is(err, ErrAgentSessionForged) {
		t.Fatalf("retargeted token = %v", err)
	}
}

func TestAgentSessionExpiryAndUnknownKey(t *testing.T) {
	keyID, privateKey, publicKeys := testSessionKeys(t)
	now := time.Unix(1_800_000_000, 0)
	token, err := MintAgentSession(
		keyID,
		privateKey,
		"account-a",
		"test",
		now.Add(time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyAgentSession(
		publicKeys,
		token,
		now.Add(time.Minute+time.Second),
	); !errors.Is(err, ErrAgentSessionExpired) {
		t.Fatalf("expired token = %v", err)
	}
	if _, err := VerifyAgentSession(
		map[string]ed25519.PublicKey{},
		token,
		now,
	); !errors.Is(err, ErrAgentSessionKey) {
		t.Fatalf("unknown key = %v", err)
	}
}

func TestFileSessionKeysMintAndVerify(t *testing.T) {
	privatePayload, err := GenerateAgentSessionKeyRing(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	publicPayload, err := PublicAgentSessionKeyRing(privatePayload)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	privatePath := filepath.Join(dir, "private.json")
	publicPath := filepath.Join(dir, "public.json")
	if err := os.WriteFile(privatePath, privatePayload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(publicPath, publicPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	signer, err := NewAgentSessionSigner(privatePath)
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := NewAgentSessionVerifier(publicPath)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	token, err := signer.Mint("account-a", "test", now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := verifier.Verify(token, now); err != nil {
		t.Fatal(err)
	}
	signerDigest, _ := signer.Digest()
	verifierDigest, _ := verifier.Digest()
	if signerDigest == "" || signerDigest != verifierDigest {
		t.Fatalf("key digests signer=%q verifier=%q", signerDigest, verifierDigest)
	}
}
