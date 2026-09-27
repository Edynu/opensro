package action

import (
	"math"
	"testing"
)

func TestRewardDwordInstructionBoundaries(t *testing.T) {
	for _, tc := range []struct {
		value float64
		want  int32
	}{
		{1.99, 1}, {-1.99, -1},
		{0x1p31 - .5, math.MaxInt32},
		{0x1p31, math.MinInt32},
		{-0x1p31 - .5, math.MinInt32},
		{-0x1p31 - 1, math.MinInt32},
		{math.Inf(1), math.MinInt32},
		{math.Inf(-1), math.MinInt32},
		{math.NaN(), math.MinInt32},
	} {
		if got := nativeRewardDword(tc.value); got != tc.want {
			t.Fatalf("CVTTSD2SI(%v) = %d, want %d", tc.value, got, tc.want)
		}
	}
}

func TestSkillRewardClampsBeforeConversion(t *testing.T) {
	for _, tc := range []struct {
		value float32
		want  int64
	}{
		{-2, 1}, {.5, 1}, {1.99, 1},
		{math.Nextafter32(0x1p31, 0), 2147483520},
		{0x1p31, math.MinInt32},
		{float32(math.Inf(-1)), 1},
		{float32(math.Inf(1)), math.MinInt32},
		{float32(math.NaN()), math.MinInt32},
	} {
		if got := nativePositiveReward(tc.value); got != tc.want {
			t.Fatalf("SEXP(%v) = %d, want %d", tc.value, got, tc.want)
		}
	}
}

func TestSkillRewardOverflowRemainsSignedThroughSharing(t *testing.T) {
	c := testCharacter()
	c.Level = testInt64(4)
	c.Masteries = nil
	target := rewardTestMangnyang()
	target.Ref.ExpToGive = 3_000_000_000
	_, shared := monsterContributionReward(c, target, testCombatRewardLevels(), target.EffectiveMaxHP(), .5, false)
	if shared != -1073741824 {
		t.Fatalf("overflow saturated or lost its sign during sharing: %d", shared)
	}
}
