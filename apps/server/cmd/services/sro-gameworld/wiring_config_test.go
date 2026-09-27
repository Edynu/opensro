package main

import (
	"testing"

	"opensro.online/server/internal/agent/api"
)

func TestConfiguredAgentURLDefaultsOnlyForDevelopment(t *testing.T) {
	t.Setenv(envAgentURL, "")
	t.Setenv(envRequireAgentURL, "")

	got, err := configuredAgentURL()
	if err != nil {
		t.Fatal(err)
	}
	if got != agentapi.DefaultAgentBaseURL {
		t.Fatalf("Agent URL = %q, want development default", got)
	}
}

func TestConfiguredAgentURLIsRequiredForManagedGameWorld(t *testing.T) {
	t.Setenv(envAgentURL, "")
	t.Setenv(envRequireAgentURL, "1")

	if _, err := configuredAgentURL(); err == nil {
		t.Fatal("managed GameWorld accepted a missing Agent URL")
	}
}

func TestConfiguredAgentURLUsesDiscoveredRoute(t *testing.T) {
	t.Setenv(envAgentURL, " http://10.0.1.10:8787/ ")
	t.Setenv(envRequireAgentURL, "1")

	got, err := configuredAgentURL()
	if err != nil {
		t.Fatal(err)
	}
	if got != "http://10.0.1.10:8787/" {
		t.Fatalf("Agent URL = %q, want discovered route", got)
	}
}
