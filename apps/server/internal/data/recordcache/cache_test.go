package recordcache

import (
	"os"
	"testing"
)

func TestRecordEvictionAndCleanup(t *testing.T) {
	c, err := New[string](2)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	name := c.file.Name()
	for id := uint32(1); id <= 8; id++ {
		if err := c.Put(id, string(rune('A'+id))); err != nil {
			t.Fatal(err)
		}
	}
	for pass := 0; pass < 2; pass++ {
		for id := uint32(1); id <= 8; id++ {
			got, ok := c.Get(id)
			if !ok || got != string(rune('A'+id)) {
				t.Fatal("eviction changed record")
			}
			if len(c.pages) > 2 {
				t.Fatal("cache exceeded capacity")
			}
		}
	}
	if _, ok := c.Get(9); ok {
		t.Fatal("missing record manufactured")
	}
	if err := c.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatal("backing file remains")
	}
}
