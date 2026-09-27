package enterworld

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestAutoPotionSaveAndReentry(t *testing.T) {
	c := &Character{Name: "potion-owner"}
	p := []byte{2, 0x11, 0xb2, 0x12, 0xb2, 0x13, 0x80, 0x8a}
	changed, err := HandleQuickSlotMessage(&Deps{}, c, p)
	if err != nil || !changed {
		t.Fatalf("save: %v %v", changed, err)
	}
	data, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var restored Character
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.AutoPotion != c.AutoPotion {
		t.Fatal("configuration lost on durable serialization")
	}
	changed, err = HandleQuickSlotMessage(&Deps{}, &restored, p)
	if err != nil || changed {
		t.Fatalf("duplicate: %v %v", changed, err)
	}
	before := restored.AutoPotion
	for _, bad := range [][]byte{{2}, {2, 1, 2, 3, 4, 5, 6}, {2, 1, 2, 3, 4, 5, 6, 7, 8}} {
		if changed, err := HandleQuickSlotMessage(&Deps{}, &restored, bad); err == nil || changed {
			t.Fatal("malformed save accepted")
		}
		if restored.AutoPotion != before {
			t.Fatal("malformed save mutated state")
		}
	}
	// Zero timing is retained on the wire; only the client substitutes defaults.
	zero := make([]byte, 8)
	zero[0] = 2
	if _, err := HandleQuickSlotMessage(&Deps{}, &restored, zero); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(restored.AutoPotion)
	if !bytes.Contains(encoded, []byte(`"timing":0`)) {
		t.Fatal(string(encoded))
	}
}
