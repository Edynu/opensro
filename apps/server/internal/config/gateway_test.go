package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/viper"
)

// writeFile drops contents at dir/name, failing the test on error.
func writeFile(t *testing.T, dir, name, contents string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(contents), 0o644); err != nil {
		t.Fatalf("write %s: %v", p, err)
	}
	return p
}

// TestNoConfigFileIsBenign pins the containerized deploy path: no config
// file anywhere means env vars plus defaults, and no error.
func TestNoConfigFileIsBenign(t *testing.T) {
	v := viper.New()
	if err := initializeIn(v, []string{t.TempDir()}); err != nil {
		t.Fatalf("no-config path must stay benign, got: %v", err)
	}
	if got := v.GetString(LogLevel); got != "info" {
		t.Fatalf("log.level default = %q, want %q", got, "info")
	}
}

// TestAcceptedFormatsLoad walks every pinned extension and proves each one
// is actually read, not just tolerated.
func TestAcceptedFormatsLoad(t *testing.T) {
	cases := map[string]string{
		"config.yaml": "log:\n  level: debug\n",
		"config.yml":  "log:\n  level: debug\n",
		"config.json": `{"log": {"level": "debug"}}`,
		"config.toml": "[log]\nlevel = \"debug\"\n",
	}
	for name, contents := range cases {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			writeFile(t, dir, name, contents)
			v := viper.New()
			if err := initializeIn(v, []string{dir}); err != nil {
				t.Fatalf("accepted format %s must load, got: %v", name, err)
			}
			if got := v.GetString(LogLevel); got != "debug" {
				t.Fatalf("log.level = %q, want %q (file not actually read?)", got, "debug")
			}
		})
	}
}

// TestLegacyFormatsRefuseBoot pins the loud-failure contract: every
// extension the old viper 1.7.1 would have parsed but the pinned contract
// rejects must produce an error naming the file and the supported formats.
func TestLegacyFormatsRefuseBoot(t *testing.T) {
	for _, ext := range unsupportedConfigExts {
		name := "config." + ext
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			p := writeFile(t, dir, name, "log.level=debug\n")
			err := initializeIn(viper.New(), []string{dir})
			if err == nil {
				t.Fatalf("%s present must refuse boot, got nil error", name)
			}
			if !strings.Contains(err.Error(), p) {
				t.Fatalf("error must name the offending file %s, got: %v", p, err)
			}
			if !strings.Contains(err.Error(), "config.{yaml|yml|json|toml}") {
				t.Fatalf("error must name the supported formats, got: %v", err)
			}
		})
	}
}

// TestShadowedLegacyFileStillRefusesBoot: an accepted config.yaml does not
// excuse a stray config.ini beside it - the stray file is precisely the
// config an operator wrongly believes is live.
func TestShadowedLegacyFileStillRefusesBoot(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "config.yaml", "log:\n  level: debug\n")
	ini := writeFile(t, dir, "config.ini", "[log]\nlevel=warn\n")
	err := initializeIn(viper.New(), []string{dir})
	if err == nil {
		t.Fatal("shadowed config.ini must still refuse boot, got nil error")
	}
	if !strings.Contains(err.Error(), ini) {
		t.Fatalf("error must name the shadowed retired file, got: %v", err)
	}
}

// TestMalformedAcceptedFileRefusesBoot: present-but-unparseable is a
// boot-stopper, never a silent fall back to defaults.
func TestMalformedAcceptedFileRefusesBoot(t *testing.T) {
	dir := t.TempDir()
	p := writeFile(t, dir, "config.yaml", "log: [unclosed\n")
	err := initializeIn(viper.New(), []string{dir})
	if err == nil {
		t.Fatal("malformed config.yaml must refuse boot, got nil error")
	}
	if !strings.Contains(err.Error(), p) {
		t.Fatalf("error must name the offending file, got: %v", err)
	}
}

// TestDiscoveryPriority pins the tie-breaks: within one directory the
// acceptedConfigExts order wins; across directories the earlier search
// path wins.
func TestDiscoveryPriority(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	yaml := writeFile(t, first, "config.yaml", "a: 1\n")
	writeFile(t, first, "config.json", `{"a": 2}`)
	writeFile(t, second, "config.yaml", "a: 3\n")

	got, err := discoverConfigFile([]string{first, second})
	if err != nil {
		t.Fatalf("discover: %v", err)
	}
	if got != yaml {
		t.Fatalf("discovered %q, want first-path config.yaml %q", got, yaml)
	}
}
