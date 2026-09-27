// Offline character rename through the exclusively locked authority store.
package main

import (
	"flag"
	"fmt"
	"os"

	"opensro.online/server/internal/data/store"
)

func main() {
	dir := flag.String("authority-dir", "", "stopped authority directory")
	shard := flag.String("shard", "", "owning shard")
	before := flag.String("character", "", "exact existing name")
	after := flag.String("name", "", "new name")
	commit := flag.Bool("commit", false, "commit the rename")
	flag.Parse()
	if flag.NArg() != 0 || *shard == "" || *before == "" || *after == "" {
		fail("-shard, -character and -name are required")
	}
	if *dir == "" {
		*dir = store.DirForShardFromEnv(*shard)
	}
	s, err := store.Open(*dir, store.Options{RequireStore: true})
	if err != nil {
		fail("open authority: %v", err)
	}
	defer s.Close()
	found := false
	for _, c := range s.Characters().CharactersForDivision(*shard) {
		if c.Name == *before {
			fmt.Printf("Rename %s/%s -> %s (character id %d, %d inventory rows)\n", *shard, *before, *after, c.ID, len(c.MissionInventory))
			found = true
		}
	}
	if !found {
		fail("character not found")
	}
	if !*commit {
		fmt.Println("Preview only; use -commit to apply.")
		return
	}
	if err := s.RenameCharacterOffline(*shard, *before, *after); err != nil {
		fail("rename: %v", err)
	}
	fmt.Println("RENAMED; GM permission is configured separately through SRO_GM_CHARACTERS.")
}

func fail(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...); os.Exit(1) }
