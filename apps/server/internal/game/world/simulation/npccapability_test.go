package simulation

import "testing"

// Falsifiers for the NPC talk capability table (npccapability.go): the
// recon-calibrated seed rows, the roster-coverage invariant that forces a
// flags decision whenever the roster grows, and the encoder-contract
// guard against the job-transport bit.

// TestNpcTalkCapabilityTableCoversTheRoster is the growth ratchet: every
// roster codename must carry a capability row. A new roster NPC without
// one would fall to the documented silent-grant degradation (no talk
// window) - this failure forces the flags DECISION at review time
// instead of leaving the gap to be discovered in play.
func TestNpcTalkCapabilityTableCoversTheRoster(t *testing.T) {
	for _, npc := range DefaultNpcRoster() {
		if _, ok := NpcTalkCapabilityFlags(npc.Codename); !ok {
			t.Errorf("roster NPC %s has no capability row - decide its 0xB45A flags in npccapability.go", npc.Codename)
		}
	}
}

// TestNpcTalkCapabilitySeedRowsPinTheReconCalibration pins the three
// calibrated words:
// smith 0x23 (shop|talk|action-0xb), warehouse 0x05 (shop|storage,
// deliberately WITHOUT the unproven talk bit), guild 0x4001 (shop|guild,
// same talk-bit decision).
func TestNpcTalkCapabilitySeedRowsPinTheReconCalibration(t *testing.T) {
	cases := []struct {
		codename string
		want     uint32
	}{
		{"NPC_EU_SMITH", 0x23},
		{"NPC_EU_WAREHOUSE", 0x05},
		{"NPC_EU_GUILD", 0x4001},
	}
	for _, c := range cases {
		got, ok := NpcTalkCapabilityFlags(c.codename)
		if !ok {
			t.Errorf("%s has no capability row", c.codename)
			continue
		}
		if got != c.want {
			t.Errorf("%s flags = 0x%X, want 0x%X", c.codename, got, c.want)
		}
	}
}

// TestNpcTalkCapabilityRowsNeverCarryTheJobTransportBit guards the
// encoder's caller contract: flags bit 0x40000000 makes the client expect
// a u16 job-transport tail EncodeNpcObjectSelectResult does not write, so no
// table row may ever carry it.
func TestNpcTalkCapabilityRowsNeverCarryTheJobTransportBit(t *testing.T) {
	for codename, flags := range reconstructedNpcServiceFlagsByCodename {
		if flags&0x40000000 != 0 {
			t.Errorf("%s carries the job-transport bit 0x40000000 - the encoder writes no u16 tail for it", codename)
		}
	}
}

// TestNpcTalkCapabilityUnknownCodenameAnswersNotOk pins the lookup's
// silent-grant contract: no row means ok=false, never a fabricated zero.
func TestNpcTalkCapabilityUnknownCodenameAnswersNotOk(t *testing.T) {
	if flags, ok := NpcTalkCapabilityFlags("NPC_TEST_NO_SUCH_ROW"); ok {
		t.Errorf("unknown codename answered flags=0x%X ok=true, want ok=false", flags)
	}
}

// The reverse-engineered service catalogue and the runtime capability word
// have different contracts. The former records every retail row; the latter
// may expose only rows with an end-to-end gameplay owner in this port.
func TestResolveNpcTalkFlagsDoesNotAdvertiseOwnerlessServiceRows(t *testing.T) {
	flags := ResolveNpcTalkFlags(NpcDef{
		Codename:         "NPC_EU_SMITH",
		BaseSpeechSymbol: "SN_NPC_EU_SMITH_BS",
		NpcTalkStoreGroups: []NpcTalkStoreGroup{{
			StoreGroupID: 7495,
			Tabs:         []NpcTalkStoreTab{{TabID: 2015, LabelSymbol: "SN_TAB_WEAPON"}},
		}},
	})
	if flags != NpcTalkFlagShop|NpcTalkFlagTalk {
		t.Fatalf("resolved smith flags = 0x%X, want implemented shop|talk only", flags)
	}
	if flags&NpcTalkFlagAction0B != 0 {
		t.Fatalf("resolved smith flags advertise ownerless action 0x0b: 0x%X", flags)
	}
}
