package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveEvidenceTextdataDirAcceptsExplicitOfflineInput(t *testing.T) {
	want := t.TempDir()
	got, err := resolveEvidenceTextdataDir("spawnable-npcs", []string{"-textdata-dir", want})
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Clean(want) {
		t.Fatalf("resolved textdata = %q, want %q", got, filepath.Clean(want))
	}
}

func TestResolveEvidenceTextdataDirRejectsUnknownOrNonDirectoryInput(t *testing.T) {
	if _, err := resolveEvidenceTextdataDir("spawnable-npcs", []string{"-unknown"}); !errors.Is(err, errCommandUsage) {
		t.Fatalf("unknown flag error = %v, want command usage", err)
	}
	file := filepath.Join(t.TempDir(), "not-a-directory.txt")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveEvidenceTextdataDir("spawnable-npcs", []string{"-textdata-dir", file}); err == nil {
		t.Fatal("non-directory explicit textdata input was accepted")
	}
}
