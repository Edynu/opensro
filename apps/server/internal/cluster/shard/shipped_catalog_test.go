package shard

import (
	"net"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestShippedCatalog(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	catalogPath := filepath.Join(filepath.Dir(file), "..", "..", "..", "config", "shards.json")
	catalog, err := Load(catalogPath)
	if err != nil {
		t.Fatalf("load shipped catalog: %v", err)
	}

	definitions := catalog.Definitions()
	if len(definitions) < 1 {
		t.Fatal("shipped catalog is empty")
	}

	seenControlPorts := map[string]string{}
	seenTransportPorts := map[string]string{}
	for _, definition := range definitions {
		if !definition.Enabled {
			continue
		}
		if prior, exists := seenControlPorts[definition.ControlURL]; exists {
			t.Fatalf("duplicate controlUrl %q on shards %q and %q", definition.ControlURL, prior, definition.ID)
		}
		seenControlPorts[definition.ControlURL] = definition.ID
		if prior, exists := seenTransportPorts[definition.TransportURL]; exists {
			t.Fatalf("duplicate transportUrl %q on shards %q and %q", definition.TransportURL, prior, definition.ID)
		}
		seenTransportPorts[definition.TransportURL] = definition.ID
		endpoint, err := url.Parse(definition.TransportURL)
		if err != nil {
			t.Fatalf("parse transportUrl for %q: %v", definition.ID, err)
		}
		if ip := net.ParseIP(endpoint.Hostname()); ip != nil &&
			ip.IsLoopback() &&
			endpoint.Scheme != "http" {
			t.Fatalf(
				"loopback shard %q transportUrl = %q; want http base for WS and cert-hash endpoint",
				definition.ID,
				definition.TransportURL,
			)
		}
		// Development clients reach every shard through their own origin
		// (localhost, a LAN address, HTTPS); the web edge routes it.
		if !strings.HasPrefix(definition.PublicTransportURL, "/") {
			t.Fatalf(
				"shipped shard %q publicTransportUrl = %q; want a same-origin edge route",
				definition.ID,
				definition.PublicTransportURL,
			)
		}
	}

	defaultShard := catalog.Default()
	if defaultShard.ID == "" {
		t.Fatal("shipped catalog has no default shard")
	}
	if !defaultShard.Enabled {
		t.Fatalf("default shard %q must be enabled", defaultShard.ID)
	}
}
