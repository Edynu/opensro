package agentapi

import (
	"net/http/httptest"
	"testing"
)

func TestMonsterQueryLocalReadOnlyBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, method, remote, host, origin, header, ref string
		want                                            int
	}{
		{"local", "GET", "127.0.0.1:1234", "127.0.0.1:8791", "", "1", "5871", 200},
		{"remote", "GET", "192.0.2.1:1234", "127.0.0.1:8791", "", "1", "5871", 403},
		{"foreign host", "GET", "127.0.0.1:1234", "example.org", "", "1", "5871", 403},
		{"browser", "GET", "127.0.0.1:1234", "127.0.0.1:8791", "http://localhost:5180", "1", "5871", 403},
		{"no header", "GET", "127.0.0.1:1234", "127.0.0.1:8791", "", "", "5871", 403},
		{"write", "POST", "127.0.0.1:1234", "127.0.0.1:8791", "", "1", "5871", 405},
		{"unbounded", "GET", "127.0.0.1:1234", "127.0.0.1:8791", "", "1", "", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			api := &API{workerShardID: "test", monsterQuery: func(ref uint32) []LiveMonsterPosition {
				calls++
				if ref != 5871 {
					t.Fatal(ref)
				}
				return []LiveMonsterPosition{}
			}}
			r := httptest.NewRequest(tc.method, "http://"+tc.host+MonsterQueryPath+"?ref="+tc.ref, nil)
			r.RemoteAddr = tc.remote
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("X-SRO-Local-Diagnostics", tc.header)
			w := httptest.NewRecorder()
			api.handleMonsterQuery(w, r)
			if w.Code != tc.want || (calls == 1) != (tc.want == 200) {
				t.Fatalf("status=%d calls=%d", w.Code, calls)
			}
		})
	}
}
