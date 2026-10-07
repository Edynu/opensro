/*
===========================================================================

petfollow_terrain_test.go - fractional terrain height must not freeze pets

===========================================================================
*/
package simulation

import "testing"

/*
================
TestPetFollowQuantizesResolvedTerrainHeight
================
*/
func TestPetFollowQuantizesResolvedTerrainHeight(t *testing.T) {
	spawn := Spawn{RegionID: 0x62a8, X: 100, Y: 10.25, Z: 100}
	owner := spawn
	owner.X += 200
	pet := NewPetFollower(55, spawn)
	terrain := func(_, to Spawn) (Spawn, *MoveError) {
		to.Y = 12.375
		return to, nil
	}
	frames := pet.Advance(owner, 80, 1000, terrain)
	if len(frames) != 2 {
		t.Fatalf("fractional terrain froze pet: %+v", frames)
	}
	if got := pet.Position(4000); got.X <= spawn.X || got.Y != 12 {
		t.Fatalf("pet did not approach on quantized terrain: %+v", got)
	}
}
