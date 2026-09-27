/*
===========================================================================

textdata_share.go - sharing immutable textdata parses in one process

===========================================================================
*/

package enterworld

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

/*
==================
sharedParses

sharedParses deduplicates immutable parses of the same shipped files within
one process. A loader that moves to bounded residency releases its entry,
so the process stops pinning the resident rows once production hands them
to the record cache. The key fingerprints every source file (path, size,
modification time), so a changed or re-extracted projection is parsed
afresh.
==================
*/
type sharedParses[T any] struct {
	mu      sync.Mutex
	entries map[string]*T
}

func (s *sharedParses[T]) get(key string, parse func() *T) *T {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.entries[key]; ok {
		return v
	}
	v := parse()
	if s.entries == nil {
		s.entries = map[string]*T{}
	}
	s.entries[key] = v
	return v
}

// release forgets one parse; loaders already holding it keep reading it.
func (s *sharedParses[T]) release(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, key)
}

// textdataFingerprint identifies the exact bytes a parse reads.
func textdataFingerprint(paths ...string) string {
	var b strings.Builder
	for _, path := range paths {
		abs, err := filepath.Abs(path)
		if err != nil {
			abs = path
		}
		b.WriteString(abs)
		if info, err := os.Stat(path); err == nil {
			b.WriteByte('|')
			b.WriteString(strconv.FormatInt(info.Size(), 10))
			b.WriteByte('|')
			b.WriteString(strconv.FormatInt(info.ModTime().UnixNano(), 10))
		} else {
			b.WriteString("|absent")
		}
		b.WriteByte('\n')
	}
	return b.String()
}
