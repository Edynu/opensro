package gamedata

import (
	"os"
	"testing"
)

func TestEarthGhostWholeProjectionAudit(t *testing.T) {
	root := os.Getenv("SRO_EARTH_GHOST_TEST_BUNDLE_ROOT")
	if root == "" {
		t.Skip("set SRO_EARTH_GHOST_TEST_BUNDLE_ROOT for the supplied-data audit")
	}
	b, err := Open(root, "sha256:5682775b689f28a468448c3a989c51fecc73932514fd26f3d02cb32779eaa603")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("verified root=%s manifest=%s content=%s files=%d dataVersion=%s", b.Root, b.ManifestDigest, b.Manifest.ContentDigest, len(b.Manifest.Files), b.Manifest.DataVersion)
}
