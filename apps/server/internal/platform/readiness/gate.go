// Package readiness owns the small process-admission boundary shared by
// HTTP handlers and the composition root.
package readiness

import (
	"net/http"
	"sync/atomic"
)

const (
	PathHealth = "/healthz"
	PathReady  = "/readyz"
)

// Gate is closed during startup and shutdown, and open only while the
// process can accept new work. It deliberately carries no lifecycle history:
// orchestration owns process state; the application owns admission.
type Gate struct {
	open atomic.Bool
}

func NewGate() *Gate {
	return &Gate{}
}

func (gate *Gate) Open() {
	gate.open.Store(true)
}

func (gate *Gate) Close() {
	gate.open.Store(false)
}

func (gate *Gate) Ready() bool {
	return gate != nil && gate.open.Load()
}

// HealthHandler is a liveness check. Reaching the handler proves that the
// process and HTTP listener can make progress; dependency health belongs in
// readiness so a shared outage does not create a restart storm.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	if !allowRead(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok"))
}

func (gate *Gate) ReadyHandler(w http.ResponseWriter, r *http.Request) {
	if !allowRead(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	if !gate.Ready() {
		http.Error(w, "not ready", http.StatusServiceUnavailable)
		return
	}
	_, _ = w.Write([]byte("ready"))
}

func allowRead(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	return false
}
