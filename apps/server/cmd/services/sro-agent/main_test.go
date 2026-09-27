package main

import "testing"

func TestAgentListenPolicy(t *testing.T) {
	cases := []struct {
		name           string
		address        string
		privateNetwork bool
		want           bool
	}{
		{"ipv4 loopback", "127.0.0.1:8787", false, true},
		{"ipv6 loopback", "[::1]:8787", false, true},
		{"localhost", "localhost:8787", false, true},
		{"public refused", "0.0.0.0:8787", false, false},
		{"private deployment", "0.0.0.0:8787", true, true},
		{"malformed refused", "8787", false, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := agentListenAllowed(
				testCase.address,
				testCase.privateNetwork,
			); got != testCase.want {
				t.Fatalf("allowed = %v, want %v", got, testCase.want)
			}
		})
	}
}
