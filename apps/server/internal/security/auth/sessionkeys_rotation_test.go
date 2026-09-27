package auth

import (
	"bytes"
	"testing"
	"time"
)

func TestAgentSessionKeyRotationPublishesBeforeActivation(t *testing.T) {
	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	original, err := GenerateAgentSessionKeyRing(now)
	if err != nil {
		t.Fatal(err)
	}
	var before agentSessionPrivateDocument
	if err := decodeSessionKeyDocument(original, &before); err != nil {
		t.Fatal(err)
	}

	prepared, pendingID, err := PrepareAgentSessionKeyRotation(
		original,
		now.Add(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	var pending agentSessionPrivateDocument
	if err := decodeSessionKeyDocument(prepared, &pending); err != nil {
		t.Fatal(err)
	}
	if pending.ActiveKeyID != before.ActiveKeyID {
		t.Fatalf(
			"prepare changed active key from %q to %q",
			before.ActiveKeyID,
			pending.ActiveKeyID,
		)
	}
	oldRing, err := parsePrivateSessionKeys(original)
	if err != nil {
		t.Fatal(err)
	}
	oldToken, err := MintAgentSession(
		before.ActiveKeyID,
		oldRing.privateKeys[before.ActiveKeyID],
		"tester",
		"global-official",
		now.Add(AgentSessionLifetime),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(pending.Keys) != 2 || pendingID == before.ActiveKeyID {
		t.Fatalf("prepared ring = %#v, pending id %q", pending, pendingID)
	}

	resumed, resumedID, err := PrepareAgentSessionKeyRotation(
		prepared,
		now.Add(2*time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	if resumedID != pendingID || !bytes.Equal(resumed, prepared) {
		t.Fatal("repeated prepare did not resume the pending rotation")
	}

	activatedAt := now.Add(3 * time.Hour)
	activated, err := ActivateAgentSessionKey(
		prepared,
		pendingID,
		activatedAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	var active agentSessionPrivateDocument
	if err := decodeSessionKeyDocument(activated, &active); err != nil {
		t.Fatal(err)
	}
	if active.ActiveKeyID != pendingID {
		t.Fatalf("active id = %q, want %q", active.ActiveKeyID, pendingID)
	}
	wantRetirement := activatedAt.Add(AgentSessionMaxLifetime).
		Format(time.RFC3339)
	if active.Keys[0].RetireAfter != wantRetirement {
		t.Fatalf(
			"old key retirement = %q, want %q",
			active.Keys[0].RetireAfter,
			wantRetirement,
		)
	}
	activatedRing, err := parsePrivateSessionKeys(activated)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyAgentSession(
		activatedRing.publicKeys,
		oldToken,
		activatedAt,
	); err != nil {
		t.Fatalf("pre-rotation session during overlap: %v", err)
	}

	retained, removed, err := RetireExpiredAgentSessionKeys(
		activated,
		activatedAt.Add(AgentSessionMaxLifetime-time.Second),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 0 || !bytes.Equal(retained, activated) {
		t.Fatal("old key retired before the maximum token lifetime")
	}

	retired, removed, err := RetireExpiredAgentSessionKeys(
		activated,
		activatedAt.Add(AgentSessionMaxLifetime),
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0] != before.ActiveKeyID {
		t.Fatalf("removed = %v, want old active key", removed)
	}
	var final agentSessionPrivateDocument
	if err := decodeSessionKeyDocument(retired, &final); err != nil {
		t.Fatal(err)
	}
	if len(final.Keys) != 1 || final.ActiveKeyID != pendingID {
		t.Fatalf("final ring = %#v", final)
	}
}

func TestAgentSessionKeyRotationPublicDigestChangesOnlyWithKeySet(
	t *testing.T,
) {
	now := time.Date(2026, 7, 31, 0, 0, 0, 0, time.UTC)
	original, err := GenerateAgentSessionKeyRing(now)
	if err != nil {
		t.Fatal(err)
	}
	prepared, pendingID, err := PrepareAgentSessionKeyRotation(
		original,
		now.Add(time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	publicPrepared, err := PublicAgentSessionKeyRing(prepared)
	if err != nil {
		t.Fatal(err)
	}
	activated, err := ActivateAgentSessionKey(
		prepared,
		pendingID,
		now.Add(2*time.Hour),
	)
	if err != nil {
		t.Fatal(err)
	}
	publicActivated, err := PublicAgentSessionKeyRing(activated)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(publicPrepared, publicActivated) {
		t.Fatal("activation changed the already-published public key ring")
	}
}
