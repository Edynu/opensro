package agentserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMarksRouteUsesNativeServerPrefixAndBoundsResponse(t *testing.T) {
	calls := 0
	first := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "" {
			t.Error("forwarded browser credential")
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("ETag", `"revision"`)
		if r.Header.Get("If-None-Match") == `"revision"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		_, _ = w.Write(bytes.Repeat([]byte{1}, 256))
	})
	second := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; _, _ = w.Write(make([]byte, 257)) })
	fixture := newAgentFixture(t, first, second)
	get := func(path, etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.Header.Set("Authorization", "Bearer should-not-forward")
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		fixture.handler.ServeHTTP(w, r)
		return w
	}
	w := get("/marks/G1_10_1.crb", "")
	if w.Code != 200 || len(w.Body.Bytes()) != 256 || w.Header().Get("Cache-Control") == "" {
		t.Fatalf("mark response %d %s", w.Code, w.Body.String())
	}
	if w := get("/marks/A1_10_1.crb", `"revision"`); w.Code != 304 || w.Body.Len() != 0 {
		t.Fatalf("conditional mark %d", w.Code)
	}
	if w := get("/marks/G2_10_1.crb", ""); w.Code != 502 {
		t.Fatalf("oversize mark %d", w.Code)
	}
	before := calls
	for _, path := range []string{"/marks/G3_10_1.crb", "/marks/G65536_10_1.crb", "/marks/X1_10_1.crb", "/marks/G1_10_1.crb?url=http://other", "/marks/G1_10_1.crb/extra"} {
		if w := get(path, ""); w.Code != 404 {
			t.Errorf("%s: %d", path, w.Code)
		}
	}
	if calls != before {
		t.Fatal("invalid route reached private worker")
	}
}
