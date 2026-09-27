package wire

import (
	"bytes"
	"errors"
	"testing"
)

// The two pinned 0x72CD goldens (bridge serializer @0x698b45): the interact
// form and the bare cancel. REV-1 pass-14 asked for these as unit pins on
// top of the runtime integration coverage.
func TestTargetInteractGoldens(t *testing.T) {
	interact := TargetInteract{Gid: 300001}
	got := interact.Encode()
	want := []byte{0x01, 0x02, 0x01, 0xE1, 0x93, 0x04, 0x00}
	if !bytes.Equal(got, want) {
		t.Fatalf("interact = % X, want % X", got, want)
	}

	cancel := TargetInteract{Cancel: true}
	if got := cancel.Encode(); !bytes.Equal(got, []byte{0x02}) {
		t.Fatalf("cancel = % X, want the bare 02", got)
	}

	for _, form := range []TargetInteract{interact, cancel} {
		decoded, err := DecodeTargetInteract(form.Encode())
		if err != nil {
			t.Fatalf("round trip of %+v failed: %v", form, err)
		}
		if decoded != form {
			t.Fatalf("round trip = %+v, want %+v", decoded, form)
		}
	}
}

func TestBasicAttackEngageGoldens(t *testing.T) {
	tests := []struct {
		name string
		form BasicAttackEngage
		want []byte
	}{
		{
			name: "world double-click or control-click",
			form: BasicAttackEngage{TargetGid: 400001},
			want: []byte{0x01, 0x01, 0x01, 0x81, 0x1A, 0x06, 0x00},
		},
		{
			name: "action pane",
			form: BasicAttackEngage{TargetGid: 400001, ActionPane: true},
			want: []byte{0x01, 0x03, 0x01, 0x81, 0x1A, 0x06, 0x00},
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			got := testCase.form.Encode()
			if !bytes.Equal(got, testCase.want) {
				t.Fatalf("engage = % X, want % X", got, testCase.want)
			}
			decoded, err := DecodeBasicAttackEngage(got)
			if err != nil || decoded != testCase.form {
				t.Fatalf("round trip = %+v, %v; want %+v", decoded, err, testCase.form)
			}
			if _, err := DecodeTargetInteract(got); err == nil {
				t.Fatal("basic attack aliased the ground-item decoder")
			}
		})
	}
}

func TestBasicAttackEngageRejectsOther72CDLegs(t *testing.T) {
	for name, payload := range map[string][]byte{
		"empty":            nil,
		"pickup":           {0x01, 0x02, 0x01, 0x81, 0x1A, 0x06, 0x00},
		"skill":            {0x01, 0x04, 0x02, 0x00, 0x00, 0x00, 0x00},
		"wrong actor kind": {0x01, 0x01, 0x02, 0x81, 0x1A, 0x06, 0x00},
		"zero gid":         {0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00},
		"trailing":         {0x01, 0x01, 0x01, 0x81, 0x1A, 0x06, 0x00, 0xFF},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeBasicAttackEngage(payload); err == nil {
				t.Fatalf("payload % X decoded, want refusal", payload)
			}
		})
	}
}

func TestTargetInteractDecodeRejectsMalformedPayloads(t *testing.T) {
	cases := []struct {
		name    string
		payload []byte
	}{
		{"empty", nil},
		{"unknown lead byte", []byte{0x03, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00}},
		{"wrong ground-leg discriminator", []byte{0x01, 0x01, 0x01, 0xE1, 0x93, 0x04, 0x00}},
		{"wrong item-kind discriminator", []byte{0x01, 0x02, 0x02, 0xE1, 0x93, 0x04, 0x00}},
		{"truncated gid", []byte{0x01, 0x02, 0x01, 0xE1, 0x93}},
		{"trailing byte on cancel", []byte{0x02, 0x00}},
		{"trailing byte on interact", []byte{0x01, 0x02, 0x01, 0xE1, 0x93, 0x04, 0x00, 0xFF}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := DecodeTargetInteract(testCase.payload); err == nil {
				t.Fatalf("payload % X decoded, want a refusal", testCase.payload)
			}
		})
	}

	// The length errors specifically surface the shared reader sentinels.
	if _, err := DecodeTargetInteract([]byte{0x01, 0x02, 0x01, 0xE1}); !errors.Is(err, ErrShortPayload) {
		t.Fatalf("short gid = %v, want ErrShortPayload", err)
	}
	if _, err := DecodeTargetInteract([]byte{0x02, 0x00}); !errors.Is(err, ErrTrailingBytes) {
		t.Fatalf("long cancel = %v, want ErrTrailingBytes", err)
	}
}
