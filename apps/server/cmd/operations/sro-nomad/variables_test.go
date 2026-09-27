package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	nomad "github.com/hashicorp/nomad/api"
	"opensro.online/server/internal/cluster/shard"
)

func TestNomadVariablePeekDistinguishesForbiddenFromMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/v1/var/missing":
				http.NotFound(response, request)
			case "/v1/var/forbidden":
				http.Error(
					response,
					"Permission denied",
					http.StatusForbidden,
				)
			default:
				http.Error(
					response,
					"unexpected test path",
					http.StatusInternalServerError,
				)
			}
		},
	))
	defer server.Close()

	config := nomad.DefaultConfig()
	config.Address = server.URL
	config.HttpClient = server.Client()
	client, err := nomad.NewClient(config)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	variable, _, err := client.Variables().Peek("missing", nil)
	if err != nil || variable != nil {
		t.Fatalf(
			"missing variable = %#v, %v; want nil, nil",
			variable,
			err,
		)
	}

	variable, _, err = client.Variables().Peek("forbidden", nil)
	if err == nil {
		t.Fatalf(
			"forbidden variable = %#v, nil; permission denial was masked",
			variable,
		)
	}
	if !strings.Contains(err.Error(), "403") {
		t.Fatalf("forbidden variable error = %q, want HTTP 403", err)
	}
}

func TestDesiredVariablesExposeOnlyPublicKeysToGameWorlds(t *testing.T) {
	privateRing := `{"activeKeyId":"private"}`
	publicRing := `{"keys":[{"id":"public"}]}`
	deployment := deployment{
		Secrets: clusterSecrets{
			SessionPrivate: privateRing,
			SessionPublic:  publicRing,
		},
		Shards: []shardDeployment{
			{Definition: shard.Definition{ID: "global-official"}},
			{Definition: shard.Definition{ID: "test"}},
		},
	}
	variables, err := deployment.desiredVariables()
	if err != nil {
		t.Fatal(err)
	}
	if len(variables) != 3 {
		t.Fatalf("variables = %d, want Agent and two GameWorlds", len(variables))
	}
	if variables[0].items["agent_session_keyring"] != privateRing {
		t.Fatal("Agent did not receive its private signing ring")
	}

	global := variables[1].items
	testShard := variables[2].items
	if global["agent_session_public_keys"] != publicRing ||
		testShard["agent_session_public_keys"] != publicRing {
		t.Fatal("GameWorlds did not receive the public verifier ring")
	}
	for _, forbidden := range []string{
		"agent_session_keyring",
		"agent_control_secret",
		"enterworld_secret",
	} {
		if _, found := global[forbidden]; found {
			t.Fatalf("GameWorld variable exposes %s", forbidden)
		}
	}
}
