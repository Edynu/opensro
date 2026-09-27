package wire

import (
	"reflect"
	"testing"
)

func TestEndedEffectInstancesExactWire(t *testing.T) {
	want := EndedEffectInstances{InstanceTokens: []uint32{0x11223344, 0x80000000}}
	payload, err := want.Encode()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(payload, []byte{0x02, 0x44, 0x33, 0x22, 0x11, 0x00, 0x00, 0x00, 0x80}) {
		t.Fatalf("payload = % X", payload)
	}
	got, err := DecodeEndedEffectInstances(payload)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("decode = %+v, %v; want %+v", got, err, want)
	}
}

func TestEndedEffectInstancesRejectsMalformedBodies(t *testing.T) {
	for _, payload := range [][]byte{
		nil,
		{0x00},
		{0x01},
		{0x01, 1, 0, 0, 0, 0xff},
	} {
		if _, err := DecodeEndedEffectInstances(payload); err == nil {
			t.Fatalf("malformed payload % X was accepted", payload)
		}
	}
	if _, err := (EndedEffectInstances{}).Encode(); err == nil {
		t.Fatal("empty ended-effect list encoded")
	}
}

func TestAttachedEffectOptionalLayouts(t *testing.T) {
	for _, status := range []bool{false, true} {
		for _, rider := range []bool{false, true} {
			effect := AttachedEffect{GID: 1, SkillID: 2, InstanceToken: 0, Phase: 2}
			want := []byte{1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0}
			if status {
				effect.Phase = 0
				want = append(want, 0)
			}
			if rider {
				effect.Rider = 0x12345678
				want = append(want, 0x78, 0x56, 0x34, 0x12)
			}
			payload, err := effect.Encode(AttachedEffectLayout{Status: status, Rider: rider})
			if err != nil || string(payload) != string(want) {
				t.Fatalf("layout %v/%v: %x %v", status, rider, payload, err)
			}
		}
	}
	if _, err := (AttachedEffect{GID: 1, SkillID: 2, Phase: 1}).Encode(AttachedEffectLayout{}); err == nil {
		t.Fatal("silently dropped status")
	}
	if _, err := (AttachedEffect{GID: 1, SkillID: 2, Phase: 2, Rider: 1}).Encode(AttachedEffectLayout{}); err == nil {
		t.Fatal("silently dropped rider")
	}
}
