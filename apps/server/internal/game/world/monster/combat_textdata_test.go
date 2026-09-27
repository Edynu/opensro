package monster

import (
	"path/filepath"
	"testing"
)

func TestShippedMangnyangCombatColumnsStayPinned(t *testing.T) {
	t.Parallel()
	dir := filepath.Join(
		"..", "..", "..", "..",
		"extracted", "Media_extracted", "server_dep", "silkroad", "textdata",
	)
	refs := LoadMonsterRefs(dir)
	ref, ok := refs[1933]
	if !ok {
		t.Skip("shipped characterdata is unavailable")
	}
	if ref.Codename != "MOB_CH_MANGNYANG" || !ref.CombatPinned ||
		ref.Level != 1 || ref.BodyRadius != 6 ||
		ref.PhysicalDefense != 7 ||
		ref.MagicalDefense != 10 ||
		ref.ParryRate != 1 ||
		ref.MagicalParry != 1 ||
		ref.EvasionRate != 27 ||
		ref.BlockRate != 0 ||
		ref.HitRate != 27 ||
		ref.CriticalRate != 2 ||
		ref.DefaultSkillIDs != [10]uint32{160, 161} {
		t.Fatalf("Mangnyang combat row moved: %+v", ref)
	}
}

func TestShippedBaroiBodyRadiusStaysPinned(t *testing.T) {
	t.Parallel()
	dir := filepath.Join(
		"..", "..", "..", "..",
		"extracted", "Media_extracted", "server_dep", "silkroad", "textdata",
	)
	refs := LoadMonsterRefs(dir)
	ref, ok := refs[5858]
	if !ok {
		t.Skip("shipped characterdata is unavailable")
	}
	if ref.Codename != "MOB_EU_BAROI" || ref.BodyRadius != 6 {
		t.Fatalf("Baroi body-radius authority moved: %+v", ref)
	}
}
