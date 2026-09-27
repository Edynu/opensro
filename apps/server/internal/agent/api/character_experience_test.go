package agentapi

import (
	"opensro.online/server/internal/domain"
	"testing"
)

func TestRosterUsesProjectedExperienceRatherThanPersistedPercentage(t *testing.T) {
	stale, current := 99.0, 8.51063829787234
	c := &domain.Character{ExperiencePercent: &stale}
	api := &API{characterPresentation: func(c *domain.Character) CharacterPresentation {
		return CharacterPresentation{ExperiencePercent: &current}
	}}
	if got := api.createdCharacterJSON(c)["experiencePercent"]; got != current {
		t.Fatalf("roster XP = %v, want %v", got, current)
	}
	current = 50
	if got := api.createdCharacterJSON(c)["experiencePercent"]; got != current {
		t.Fatalf("roster retained previous XP: %v", got)
	}
	api.characterPresentation = func(*domain.Character) CharacterPresentation { return CharacterPresentation{} }
	if _, ok := api.createdCharacterJSON(c)["experiencePercent"]; ok {
		t.Fatal("missing projection fell back to stale percentage")
	}
}
