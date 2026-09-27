package shard

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCatalogResolveAndStableOrder(t *testing.T) {
	catalog, err := NewCatalog([]Definition{
		{
			ID: "test", Name: "Test", NativeServerID: 2,
			Capacity: 50, Test: true, Enabled: true,
			ControlURL: "http://127.0.0.1:8792", TransportURL: "https://127.0.0.1:8793",
		},
		{
			ID: "global-official", Name: "GlobalOfficial", NativeServerID: 1,
			Capacity: 1000, Default: true, Enabled: true,
			ControlURL: "http://127.0.0.1:8791", TransportURL: "https://127.0.0.1:8788",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := catalog.Default().ID; got != "global-official" {
		t.Fatalf("default shard = %q", got)
	}
	if got := catalog.IDs(); len(got) != 2 || got[0] != "global-official" || got[1] != "test" {
		t.Fatalf("stable IDs = %v", got)
	}
	if got, ok := catalog.Resolve(""); !ok || got.ID != "global-official" {
		t.Fatalf("empty resolve = %+v, %v", got, ok)
	}
	if _, ok := catalog.Resolve("unknown"); ok {
		t.Fatal("unknown shard resolved")
	}
}

func TestCatalogRefusesAmbiguousAuthority(t *testing.T) {
	tests := []struct {
		name string
		rows []Definition
	}{
		{name: "empty"},
		{
			name: "no default",
			rows: []Definition{{
				ID: "a", Name: "A", NativeServerID: 1,
				Capacity: 1, Enabled: true,
				ControlURL: "http://127.0.0.1:1", TransportURL: "https://127.0.0.1:2",
			}},
		},
		{
			name: "two defaults",
			rows: []Definition{
				testDefinition("a", 1, true),
				testDefinition("b", 2, true),
			},
		},
		{
			name: "duplicate native id",
			rows: []Definition{
				testDefinition("a", 1, true),
				testDefinition("b", 1, false),
			},
		},
		{
			name: "unsafe id",
			rows: []Definition{{
				ID: "A:bad", Name: "A", NativeServerID: 1,
				Capacity: 1, Default: true, Enabled: true,
				ControlURL: "http://127.0.0.1:1", TransportURL: "https://127.0.0.1:2",
			}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := NewCatalog(test.rows); err == nil {
				t.Fatal("invalid catalog accepted")
			}
		})
	}
}

func TestPublicTransportURL(t *testing.T) {
	routed := testDefinition("a", 1, true)
	routed.PublicTransportURL = "/shards/a"
	direct := testDefinition("b", 2, false)
	direct.PublicTransportURL = "https://play.example.com/b"
	catalog, err := NewCatalog([]Definition{routed, direct, testDefinition("c", 3, false)})
	if err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]string{"a": "/shards/a", "b": "https://play.example.com/b", "c": "https://127.0.0.1:2"} {
		definition, _ := catalog.Resolve(id)
		if got := definition.AdvertisedTransportURL(); got != want {
			t.Fatalf("shard %q advertises %q, want %q", id, got, want)
		}
	}
	for _, raw := range []string{"shards/a", "/", "//evil.example/a", "/shards/a/", "/shards/../a", "/shards/a?x=1", "/shards/a#x", "/shards/a b", "ftp://host/a"} {
		invalid := testDefinition("a", 1, true)
		invalid.PublicTransportURL = raw
		if _, err := NewCatalog([]Definition{invalid}); err == nil {
			t.Fatalf("publicTransportUrl %q accepted", raw)
		}
	}
	shared := testDefinition("b", 2, false)
	shared.PublicTransportURL = routed.PublicTransportURL
	if _, err := NewCatalog([]Definition{routed, shared}); err == nil {
		t.Fatal("two shards share one public route")
	}
}

func TestLoadIsStrict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shards.json")
	raw := `{"shards":[{"id":"a","name":"A","nativeServerId":1,"nativeFarmId":0,"capacity":10,"default":true,"test":false,"enabled":true,"controlUrl":"http://127.0.0.1:1","transportUrl":"https://127.0.0.1:2"}]}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Default().ID != "a" {
		t.Fatalf("default = %+v", catalog.Default())
	}

	if err := os.WriteFile(path, []byte(`{"shards":[],"typo":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("unknown field accepted")
	}
}

func testDefinition(id string, nativeID uint16, defaultShard bool) Definition {
	return Definition{
		ID: id, Name: id, NativeServerID: nativeID, Capacity: 1,
		Default: defaultShard, Enabled: true,
		ControlURL: "http://127.0.0.1:1", TransportURL: "https://127.0.0.1:2",
	}
}
