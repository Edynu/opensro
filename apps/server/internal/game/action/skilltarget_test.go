/*
===========================================================================

skilltarget_test.go - tests for skilltarget.go

===========================================================================
*/

package action

import (
	"testing"

	"opensro.online/server/internal/game/enterworld"
)

/*
==================
TestSkillTargetPermissionNativeArms

58D7A0 arms that differ from a plain "players only" rule: Enemy_P only
refuses a living target, and a building-only row admits a player who
shares the caster's party object (+0x1CB8).
==================
*/
func TestSkillTargetPermissionNativeArms(t *testing.T) {
	enemyP := enterworld.SkillTargets{Animal: true, EnemyP: true}
	if skillTargetPermission(enemyP, false, true, false) {
		t.Error("Enemy_P admitted a living player")
	}
	if !skillTargetPermission(enemyP, false, false, false) {
		t.Error("Enemy_P refused a dead player")
	}

	kit := enterworld.SkillTargets{Required: true, Building: true}
	if skillTargetPermission(kit, false, true, false) {
		t.Error("building-only admitted a player outside the party")
	}
	if !skillTargetPermission(kit, false, true, true) {
		t.Error("building-only refused a party member")
	}

	selfOnly := enterworld.SkillTargets{Animal: true, Self: true}
	if skillTargetPermission(selfOnly, false, true, true) {
		t.Error("Self without Ally admitted another player")
	}
}
