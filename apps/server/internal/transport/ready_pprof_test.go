package transport_test

// Readiness and pprof exposure, over the real TCP listener: readyz is
// distinct from healthz (it consults the injected readiness source), and
// pprof serves ONLY when explicitly enabled.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"opensro.online/server/internal/transport"
)

func httpGet(t *testing.T, url string) (int, string) {
	t.Helper()
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(body)
}

func TestReadyzReflectsInjectedCheck(t *testing.T) {
	srv := startServer(t)
	url := fmt.Sprintf("http://%s%s", srv.WSAddr(), transport.PathReady)

	// Listeners up, no check injected: ready by default.
	if code, body := httpGet(t, url); code != http.StatusOK || body != "ready" {
		t.Fatalf("unwired readyz = %d %q, want 200 ready", code, body)
	}

	// A failing injected source flips readiness — liveness untouched.
	srv.SetReadyCheck(func() error { return errors.New("authority store degraded") })
	if code, body := httpGet(t, url); code != http.StatusServiceUnavailable ||
		body != "not ready: authority store degraded" {
		t.Fatalf("degraded readyz = %d %q, want 503 with the check's reason", code, body)
	}
	wsURL := fmt.Sprintf("http://%s%s", srv.WSAddr(), transport.PathWS)
	if code, _ := httpGet(t, wsURL); code != http.StatusServiceUnavailable {
		t.Fatalf("websocket admission while not-ready = %d, want 503", code)
	}
	healthURL := fmt.Sprintf("http://%s%s", srv.WSAddr(), transport.PathHealth)
	if code, body := httpGet(t, healthURL); code != http.StatusOK || body != "ok" {
		t.Fatalf("healthz while not-ready = %d %q, want 200 ok (liveness is separate)", code, body)
	}

	// Recovery: clearing the check restores readiness.
	srv.SetReadyCheck(nil)
	if code, _ := httpGet(t, url); code != http.StatusOK {
		t.Fatalf("recovered readyz = %d, want 200", code)
	}
}

func TestPprofDisabledByDefault(t *testing.T) {
	srv := startServer(t) // default config: EnablePprof false
	url := fmt.Sprintf("http://%s/debug/pprof/", srv.WSAddr())
	if code, _ := httpGet(t, url); code != http.StatusNotFound {
		t.Fatalf("pprof off: GET /debug/pprof/ = %d, want 404", code)
	}
}

func TestPprofServesWhenEnabled(t *testing.T) {
	srv, err := transport.NewServer(transport.Config{
		WTAddr:      "127.0.0.1:0",
		WSAddr:      "127.0.0.1:0",
		CertDir:     t.TempDir(),
		EnablePprof: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	installSmokeAdmissionVerifier(srv)
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	})

	url := fmt.Sprintf("http://%s/debug/pprof/", srv.WSAddr())
	code, body := httpGet(t, url)
	if code != http.StatusOK {
		t.Fatalf("pprof on: GET /debug/pprof/ = %d, want 200", code)
	}
	if len(body) == 0 {
		t.Fatal("pprof index answered an empty body")
	}
}
