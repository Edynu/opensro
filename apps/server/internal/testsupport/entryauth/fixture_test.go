package entryauth

import (
	"testing"
	"time"

	"opensro.online/server/internal/security/auth"
	"opensro.online/server/internal/transport"
)

func TestAuthenticatedEntryFixtureUsesRealIdentityBoundToken(t *testing.T) {
	entry := NewAuthenticatedEntryFixture(t, "global-official", "asd2")
	if _, err := transport.DecodeEnterWorld(transport.EncodeEnterWorld(entry)); err != nil {
		t.Fatalf("fixture wire roundtrip: %v", err)
	}
	if err := auth.Verify(
		authenticatedFixtureSecret,
		string(entry.AuthToken),
		entry.Division,
		entry.CharName,
		time.Now(),
	); err != nil {
		t.Fatalf("fixture token verification: %v", err)
	}
}

func TestRejectedEntryFixtureBindsTokenToDifferentIdentity(t *testing.T) {
	fixture := &SessionFixture{t: t}
	entry := fixture.RejectedEntry("global-official", "asd2")
	if err := auth.Verify(
		authenticatedFixtureSecret,
		string(entry.AuthToken),
		entry.Division,
		entry.CharName,
		time.Now(),
	); err == nil {
		t.Fatal("rejected fixture unexpectedly verified")
	}
}
