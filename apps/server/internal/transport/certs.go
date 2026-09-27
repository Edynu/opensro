package transport

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"

	"opensro.online/server/internal/platform/privatepath"
)

// Browser rules for WebTransport serverCertificateHashes: the certificate
// must use an ECDSA key and be valid for at most 14 days. We issue 12 days
// and regenerate when less than 48h remain, so a cert handed to a client is
// always comfortably inside the window.
const (
	devCertValidity    = 12 * 24 * time.Hour
	devCertRegenWithin = 48 * time.Hour

	devCertFile = "wt-dev-cert.pem"
	devKeyFile  = "wt-dev-key.pem"
	devHashFile = "wt-cert-hash.json"
)

// Certificate is the TLS identity served by WebTransport, plus the SHA-256
// digest development clients may pin through serverCertificateHashes.
type Certificate struct {
	TLS         tls.Certificate
	Leaf        *x509.Certificate
	SHA256      [sha256.Size]byte
	CertPath    string
	KeyPath     string
	HashPath    string
	Regenerated bool // true when this call created a new cert
}

// SHA256Hex is the digest as lowercase hex.
func (c *Certificate) SHA256Hex() string { return hex.EncodeToString(c.SHA256[:]) }

// SHA256Base64 is the digest as standard base64, the handiest form for the
// browser's Uint8Array conversion.
func (c *Certificate) SHA256Base64() string {
	return base64.StdEncoding.EncodeToString(c.SHA256[:])
}

// certHashDoc is what /transport/cert-hash serves and what lands next to the
// PEM files for tooling.
type certHashDoc struct {
	Algorithm    string `json:"algorithm"`
	SHA256Hex    string `json:"sha256Hex"`
	SHA256Base64 string `json:"sha256Base64"`
	NotBefore    string `json:"notBefore"`
	NotAfter     string `json:"notAfter"`
}

// LoadCertificate selects the explicit read-only TLS pair when configured.
// With no explicit pair it loads or generates the managed development
// certificate in devDir.
func LoadCertificate(certFile, keyFile, devDir string) (*Certificate, error) {
	if (certFile == "") != (keyFile == "") {
		return nil, fmt.Errorf("transport: certificate file and key file must be configured together")
	}
	if certFile != "" {
		return loadExplicitCertificate(certFile, keyFile, time.Now())
	}
	return ensureDevelopmentCertificateAt(devDir, time.Now)
}

func ensureDevelopmentCertificateAt(dir string, now func() time.Time) (*Certificate, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("transport: creating cert dir: %w", err)
	}
	if err := privatepath.ProtectDirectory(dir); err != nil {
		return nil, fmt.Errorf("transport: securing cert dir: %w", err)
	}
	certPath := filepath.Join(dir, devCertFile)
	keyPath := filepath.Join(dir, devKeyFile)
	hashPath := filepath.Join(dir, devHashFile)
	if info, err := os.Lstat(keyPath); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("transport: development private key must not be a symlink")
		}
		if err := privatepath.ProtectFile(keyPath); err != nil {
			return nil, fmt.Errorf("transport: securing development private key: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("transport: inspecting development private key: %w", err)
	}

	if certificate, err := loadDevelopmentCertificate(certPath, keyPath, hashPath, now()); err == nil {
		return certificate, nil
	}
	return generateDevelopmentCertificate(certPath, keyPath, hashPath, now())
}

func loadExplicitCertificate(certPath, keyPath string, now time.Time) (*Certificate, error) {
	certificate, err := loadCertificatePair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	if now.Before(certificate.Leaf.NotBefore) || now.After(certificate.Leaf.NotAfter) {
		return nil, fmt.Errorf(
			"transport: certificate is not valid at %s (valid %s through %s)",
			now.UTC().Format(time.RFC3339),
			certificate.Leaf.NotBefore.UTC().Format(time.RFC3339),
			certificate.Leaf.NotAfter.UTC().Format(time.RFC3339),
		)
	}
	return certificate, nil
}

func loadDevelopmentCertificate(certPath, keyPath, hashPath string, now time.Time) (*Certificate, error) {
	certificate, err := loadCertificatePair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	if now.Before(certificate.Leaf.NotBefore) || now.After(certificate.Leaf.NotAfter.Add(-devCertRegenWithin)) {
		return nil, fmt.Errorf("transport: development certificate outside its usable window")
	}
	certificate.HashPath = hashPath
	if _, err := os.Stat(hashPath); err != nil {
		if err := writeHashDoc(certificate); err != nil {
			return nil, err
		}
	}
	return certificate, nil
}

func loadCertificatePair(certPath, keyPath string) (*Certificate, error) {
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, fmt.Errorf("transport: loading TLS certificate pair: %w", err)
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, fmt.Errorf("transport: parsing TLS leaf certificate: %w", err)
	}
	pair.Leaf = leaf
	return &Certificate{
		TLS:      pair,
		Leaf:     leaf,
		SHA256:   sha256.Sum256(leaf.Raw),
		CertPath: certPath,
		KeyPath:  keyPath,
	}, nil
}

func generateDevelopmentCertificate(certPath, keyPath, hashPath string, now time.Time) (*Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("transport: generating ECDSA key: %w", err)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("transport: generating serial: %w", err)
	}
	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "sro-go-gateway dev transport"},
		// Backdated an hour so a client with mild clock skew still accepts it.
		NotBefore:             now.Add(-1 * time.Hour),
		NotAfter:              now.Add(devCertValidity),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("transport: creating certificate: %w", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("transport: marshaling key: %w", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return nil, fmt.Errorf("transport: writing cert: %w", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return nil, fmt.Errorf("transport: writing key: %w", err)
	}
	if err := privatepath.ProtectFile(keyPath); err != nil {
		return nil, fmt.Errorf("transport: securing key: %w", err)
	}

	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	leaf, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	pair.Leaf = leaf
	certificate := &Certificate{
		TLS:         pair,
		Leaf:        leaf,
		SHA256:      sha256.Sum256(der),
		CertPath:    certPath,
		KeyPath:     keyPath,
		HashPath:    hashPath,
		Regenerated: true,
	}
	if err := writeHashDoc(certificate); err != nil {
		return nil, err
	}
	return certificate, nil
}

func writeHashDoc(certificate *Certificate) error {
	doc := certHashDoc{
		Algorithm:    "sha-256",
		SHA256Hex:    certificate.SHA256Hex(),
		SHA256Base64: certificate.SHA256Base64(),
		NotBefore:    certificate.Leaf.NotBefore.UTC().Format(time.RFC3339),
		NotAfter:     certificate.Leaf.NotAfter.UTC().Format(time.RFC3339),
	}
	body, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(certificate.HashPath, body, 0o644); err != nil {
		return fmt.Errorf("transport: writing cert hash doc: %w", err)
	}
	return nil
}
