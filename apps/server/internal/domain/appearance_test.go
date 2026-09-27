package domain

import "testing"

func TestStartProfileReturnsOwnedModelMap(t *testing.T) {
	first := StartProfileForRace(RaceKeyEurope)
	first.DefaultModelRefByGender[GenderMale] = 1

	second := StartProfileForRace(RaceKeyEurope)
	if second.DefaultModelRefByGender[GenderMale] == 1 {
		t.Fatal("start profile exposes mutable package-owned model data")
	}
}
