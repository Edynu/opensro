package agentapi

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

const ObservatoryPath = "/internal/diagnostics/observatory"

type observatoryReader struct {
	summary func() any
	mu      sync.Mutex
	read    func() any
	at      time.Time
	encoded []byte
}

// Installed before Start; one shared two-second capture regardless of readers.
func (api *API) InstallObservatory(read func() any)        { api.observatory = &observatoryReader{read: read} }
func (api *API) InstallObservatorySummary(read func() any) { api.observatory.summary = read }

/*
==================
handleObservatory

Serves the local operator snapshot. Every reader shares one encoded capture,
refreshed at most every two seconds, so polling dashboards cost one read.
A failed body write means the client went away; there is nobody to tell.
==================
*/
func (api *API) handleObservatory(w http.ResponseWriter, r *http.Request) {
	if !localDiagnosticsRequest(r) {
		http.Error(w, "local operator request required", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	reader := api.observatory
	if r.URL.Query().Get("summary") == "1" && reader.summary != nil {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(reader.summary())
		return
	}
	reader.mu.Lock()
	if time.Since(reader.at) >= 2*time.Second || reader.encoded == nil {
		bytes, err := json.Marshal(reader.read())
		if err != nil {
			reader.mu.Unlock()
			http.Error(w, "snapshot unavailable", http.StatusServiceUnavailable)
			return
		}
		reader.encoded = bytes
		reader.at = time.Now()
	}
	bytes := reader.encoded
	reader.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(bytes)
}
