package workload

import "testing"

func TestNewRequiresTLSOutsideLoopback(t *testing.T) {
	if _, err := NewNomadWorkloadIdentityVerifier(
		"http://nomad.internal:4646",
		"http://nomad.internal:4646/.well-known/jwks.json",
		nil,
	); err == nil {
		t.Fatal("non-loopback plaintext identity authority was accepted")
	}
	if _, err := NewNomadWorkloadIdentityVerifier(
		"http://127.0.0.1:4646",
		"http://127.0.0.1:4646/.well-known/jwks.json",
		nil,
	); err != nil {
		t.Fatalf("loopback development identity authority: %v", err)
	}
}
