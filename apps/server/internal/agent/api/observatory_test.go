package agentapi

import (
	"net/http/httptest"
	"testing"
	"time"
)

func TestObservatorySharesCaptureAndRejectsBrowserBypass(t *testing.T) {
	calls := 0
	api := &API{}
	api.InstallObservatory(func() any { calls++; return map[string]int{"capture": calls} })
	request := func(origin, method string) int {
		r := httptest.NewRequest(method, "http://127.0.0.1:8791"+ObservatoryPath, nil)
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("X-SRO-Local-Diagnostics", "1")
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		api.handleObservatory(w, r)
		return w.Code
	}
	if request("http://evil.example", "GET") != 403 || request("", "POST") != 405 || calls != 0 {
		t.Fatal("invalid request reached capture")
	}
	for i := 0; i < 5; i++ {
		if request("", "GET") != 200 {
			t.Fatal("capture failed")
		}
	}
	if calls != 1 {
		t.Fatalf("readers multiplied capture work: %d", calls)
	}
	api.observatory.at = time.Now().Add(-3 * time.Second)
	request("", "GET")
	if calls != 2 {
		t.Fatal("cache did not refresh")
	}
}
