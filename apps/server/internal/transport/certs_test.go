package transport

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadCertificateGeneratesDevelopmentCertificate(t *testing.T) {
	dir := t.TempDir()
	dc, err := LoadCertificate("", "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if !dc.Regenerated {
		t.Fatal("first call should generate")
	}

	key, ok := dc.Leaf.PublicKey.(*ecdsa.PublicKey)
	if !ok {
		t.Fatalf("public key is %T, serverCertificateHashes requires ECDSA", dc.Leaf.PublicKey)
	}
	if key.Curve != elliptic.P256() {
		t.Fatalf("curve = %v, want P-256", key.Curve)
	}
	validity := dc.Leaf.NotAfter.Sub(dc.Leaf.NotBefore)
	if validity > 14*24*time.Hour {
		t.Fatalf("validity %v exceeds the 14-day serverCertificateHashes limit", validity)
	}

	var hasLocalhost, hasLoopback bool
	for _, d := range dc.Leaf.DNSNames {
		if d == "localhost" {
			hasLocalhost = true
		}
	}
	for _, ip := range dc.Leaf.IPAddresses {
		if ip.String() == "127.0.0.1" {
			hasLoopback = true
		}
	}
	if !hasLocalhost || !hasLoopback {
		t.Fatalf("SANs missing localhost/127.0.0.1: DNS=%v IP=%v", dc.Leaf.DNSNames, dc.Leaf.IPAddresses)
	}

	for _, f := range []string{devCertFile, devKeyFile, devHashFile} {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Fatalf("expected %s on disk: %v", f, err)
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, devHashFile))
	if err != nil {
		t.Fatal(err)
	}
	var doc certHashDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Algorithm != "sha-256" || doc.SHA256Hex != dc.SHA256Hex() || doc.SHA256Base64 != dc.SHA256Base64() {
		t.Fatalf("hash doc %+v does not match cert (hex %s)", doc, dc.SHA256Hex())
	}
}

func TestLoadCertificateReusesDevelopmentCertificate(t *testing.T) {
	dir := t.TempDir()
	first, err := LoadCertificate("", "", dir)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LoadCertificate("", "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if second.Regenerated {
		t.Fatal("second call regenerated a still-fresh cert")
	}
	if first.SHA256 != second.SHA256 {
		t.Fatal("reloaded cert hash differs")
	}
}

func TestDevelopmentCertificateRegeneratesNearExpiry(t *testing.T) {
	dir := t.TempDir()
	first, err := LoadCertificate("", "", dir)
	if err != nil {
		t.Fatal(err)
	}
	// 11 days later the 12-day cert is inside the 48h regen window.
	later := func() time.Time { return time.Now().Add(11 * 24 * time.Hour) }
	second, err := ensureDevelopmentCertificateAt(dir, later)
	if err != nil {
		t.Fatal(err)
	}
	if !second.Regenerated {
		t.Fatal("near-expiry cert was not regenerated")
	}
	if first.SHA256 == second.SHA256 {
		t.Fatal("regenerated cert has the same hash")
	}
}

func TestLoadCertificateRequiresExplicitPair(t *testing.T) {
	if _, err := LoadCertificate("certificate.pem", "", t.TempDir()); err == nil {
		t.Fatal("certificate without key was accepted")
	}
	if _, err := LoadCertificate("", "key.pem", t.TempDir()); err == nil {
		t.Fatal("key without certificate was accepted")
	}
}

func TestExplicitCertificateIsReadOnlyInsideDevelopmentRenewalWindow(t *testing.T) {
	dir := t.TempDir()
	generated, err := LoadCertificate("", "", dir)
	if err != nil {
		t.Fatal(err)
	}

	insideDevelopmentRenewalWindow := generated.Leaf.NotAfter.Add(-time.Hour)
	explicit, err := loadExplicitCertificate(
		generated.CertPath,
		generated.KeyPath,
		insideDevelopmentRenewalWindow,
	)
	if err != nil {
		t.Fatalf("explicit certificate inside development renewal window: %v", err)
	}
	if explicit.Regenerated {
		t.Fatal("explicit certificate was marked regenerated")
	}
	if explicit.SHA256 != generated.SHA256 {
		t.Fatal("explicit certificate changed on load")
	}
	if explicit.HashPath != "" {
		t.Fatalf("explicit certificate hash path = %q, want no managed sidecar", explicit.HashPath)
	}
}
