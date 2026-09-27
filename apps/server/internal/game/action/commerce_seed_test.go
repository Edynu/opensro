package action

import (
	"bytes"
	"opensro.online/server/internal/game/item/commerce"
	"opensro.online/server/internal/game/item/inventory"
	"testing"
)

func TestCompressedCommerceSeedPreservesWireAndDetachedReads(t *testing.T) {
	rt, _ := merchantFixture(t)
	offers := rt.Commerce.Tabs[1]
	ref := offers[0].Ref
	offers[0].Contents = []commerce.Content{{Ref: ref}}
	rt.prepareCommerceReferences()
	want := rt.commerceReferences([]inventory.Item{{RefObjID: ref.RefObjID, Codename: ref.Codename, TypeFlags: ref.TypeFlags()}}, nil)
	got := rt.CommerceReferenceSeed()
	if len(got) != 1 || got[0].Opcode != want.Opcode || !bytes.Equal(got[0].Payload, want.Payload) {
		t.Fatal("seed wire bytes changed")
	}
	got[0].Payload[0] ^= 255
	if !bytes.Equal(rt.CommerceReferenceSeed()[0].Payload, want.Payload) {
		t.Fatal("caller mutated retained seed")
	}
}
