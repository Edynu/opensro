package readiness

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGateSeparatesLivenessFromReadiness(t *testing.T) {
	gate := NewGate()

	assertStatus(t, http.HandlerFunc(HealthHandler), PathHealth, http.StatusOK)
	assertStatus(t, http.HandlerFunc(gate.ReadyHandler), PathReady, http.StatusServiceUnavailable)

	gate.Open()
	assertStatus(t, http.HandlerFunc(gate.ReadyHandler), PathReady, http.StatusOK)

	gate.Close()
	assertStatus(t, http.HandlerFunc(gate.ReadyHandler), PathReady, http.StatusServiceUnavailable)
}

func TestHealthAndReadyAreReadOnly(t *testing.T) {
	gate := NewGate()
	for _, handler := range []http.Handler{
		http.HandlerFunc(HealthHandler),
		http.HandlerFunc(gate.ReadyHandler),
	} {
		request := httptest.NewRequest(http.MethodPost, "/", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("POST status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
		}
	}
}

func assertStatus(t *testing.T, handler http.Handler, path string, want int) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != want {
		t.Fatalf("%s status = %d, want %d", path, response.Code, want)
	}
}
