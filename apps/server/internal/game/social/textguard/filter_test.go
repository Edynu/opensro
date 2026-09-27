package textguard

import "testing"

func TestNativeShardTextAdmission(t *testing.T) {
	for _, tc := range []struct {
		input    string
		rejected bool
	}{
		{"Meet at the gate.", false}, {"Caf\xe9", false}, {"DROP TABLE treasure", false},
		{"before -- after", true}, {"before /* after", true}, {"*/", true}, {"100%%", true},
		{"semi;colon", true}, {"can't", true}, {"say \"hello\"", true},
		{"_CHARACTER", true}, {"prefixSYSOBJECTSsuffix", true}, {"XP_anything", true},
		{"_OpenMarket", false}, {"_openmarket", false}, // native mixed-case entry is not folded
		{"\xe9SYSOBJECTS", false}, // following S is copied unchanged, so substring fails
		{"\xe9sYSOBJECTS", true}, {"\xe9'", true},
		{"safe\x00_char", false}, {"_char\x00safe", true}, {"", false},
	} {
		if got := Rejected([]byte(tc.input)); got != tc.rejected {
			t.Errorf("%q = %v want %v", tc.input, got, tc.rejected)
		}
	}
}

func TestShardTextAdmissionDoesNotMutatePacket(t *testing.T) {
	input := []byte("SYSOBJECTS")
	if !Rejected(input) || string(input) != "SYSOBJECTS" {
		t.Fatal("lost predicate or mutated packet")
	}
}
