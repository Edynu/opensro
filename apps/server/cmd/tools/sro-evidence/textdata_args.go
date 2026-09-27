package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"opensro.online/server/internal/gamedata"
)

// resolveEvidenceTextdataDir keeps deployed server commands on the verified
// game-data projection while allowing read-only build tools to name their
// extracted input explicitly. The browser resource graph must not need a
// partially built server release just to ask server-owned classifiers which
// model identities are spawnable.
func resolveEvidenceTextdataDir(command string, args []string) (string, error) {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var explicit string
	flags.StringVar(&explicit, "textdata-dir", "", "explicit extracted textdata input for offline evidence builds")
	if err := flags.Parse(args); err != nil {
		return "", fmt.Errorf("%w: %v", errCommandUsage, err)
	}
	if flags.NArg() != 0 {
		return "", fmt.Errorf("%w: unexpected arguments %q", errCommandUsage, flags.Args())
	}
	explicit = strings.TrimSpace(explicit)
	if explicit == "" {
		return gamedata.ResolveTextdataDir()
	}
	absolute, err := filepath.Abs(explicit)
	if err != nil {
		return "", fmt.Errorf("resolve explicit textdata directory: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("open explicit textdata directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("explicit textdata path is not a directory: %s", absolute)
	}
	return filepath.Clean(absolute), nil
}
