package transport

import (
	"net/http/httptest"
	"testing"
)

// The two tests below pin the rule that an empty allowlist means loopback-only
// (never accept-any), and a configured allowlist is exhaustive.

func TestOriginCheckerEmptyAllowsLoopbackOnly(t *testing.T) {
	check := newOriginChecker(nil)

	allow := []string{
		"", // non-browser clients send no Origin
		"http://localhost:5173",
		"https://localhost",
		"http://127.0.0.1:8788",
		"http://[::1]:3000",
	}
	for _, origin := range allow {
		r := httptest.NewRequest("GET", "/transport/ws", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if !check(r) {
			t.Fatalf("origin %q rejected, want allowed (loopback dev posture)", origin)
		}
	}

	deny := []string{
		"https://evil.example.com",
		"http://192.168.1.10:5173", // LAN is not loopback
		"http://localhost.evil.com",
		"null", // sandboxed-iframe Origin
		"garbage",
	}
	for _, origin := range deny {
		r := httptest.NewRequest("GET", "/transport/ws", nil)
		r.Header.Set("Origin", origin)
		if check(r) {
			t.Fatalf("origin %q accepted with empty allowlist — accept-any regression (S1)", origin)
		}
	}
}

func TestOriginCheckerConfiguredIsExhaustive(t *testing.T) {
	check := newOriginChecker([]string{"https://game.example.com", "http://localhost:5173/"})

	allow := []string{
		"",
		"https://game.example.com",
		"HTTPS://GAME.EXAMPLE.COM", // case-insensitive
		"http://localhost:5173",    // trailing slash in config ignored
	}
	for _, origin := range allow {
		r := httptest.NewRequest("GET", "/transport/ws", nil)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if !check(r) {
			t.Fatalf("origin %q rejected, want allowed (configured)", origin)
		}
	}

	deny := []string{
		"http://localhost:9999", // loopback is NOT implicit once a list exists
		"http://127.0.0.1:5173",
		"https://other.example.com",
	}
	for _, origin := range deny {
		r := httptest.NewRequest("GET", "/transport/ws", nil)
		r.Header.Set("Origin", origin)
		if check(r) {
			t.Fatalf("origin %q accepted, want rejected (allowlist is exhaustive)", origin)
		}
	}
}
