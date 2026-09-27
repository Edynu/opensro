package agentapi

import (
	"net"
	"net/http"
	"strconv"
)

const MonsterQueryPath = "/internal/diagnostics/monsters"

type LiveMonsterPosition struct {
	GID      uint32  `json:"gid"`
	RefObjID uint32  `json:"refObjId"`
	Name     string  `json:"name"`
	HP       uint32  `json:"hp"`
	RegionID uint16  `json:"regionId"`
	LocalX   float64 `json:"localX"`
	LocalZ   float64 `json:"localZ"`
}
type MonsterPositionQuery func(ref uint32) []LiveMonsterPosition

// Composition installs before Start. The callback is bound to the owned shard.
func (api *API) InstallMonsterQuery(query MonsterPositionQuery) { api.monsterQuery = query }
func localDiagnosticsRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	requestHost, _, hostErr := net.SplitHostPort(r.Host)
	if hostErr != nil {
		requestHost = r.Host
	}
	return err == nil && net.ParseIP(host).IsLoopback() && net.ParseIP(requestHost).IsLoopback() && r.Header.Get("Origin") == "" && r.Header.Get("X-Forwarded-For") == "" && r.Header.Get("Forwarded") == "" && r.Header.Get("X-SRO-Local-Diagnostics") == "1"
}
func (api *API) handleMonsterQuery(w http.ResponseWriter, r *http.Request) {
	if !localDiagnosticsRequest(r) {
		http.Error(w, "local operator request required", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ref, err := strconv.ParseUint(r.URL.Query().Get("ref"), 10, 32)
	if err != nil || ref == 0 {
		http.Error(w, "positive ref required", http.StatusBadRequest)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"shard": api.workerShardID, "monsters": api.monsterQuery(uint32(ref))})
}
