package wire

import (
	"bytes"
	"testing"
)

func TestEquipVisualCarriesTheOptTailForEquipment(t *testing.T) {
	word := PackTypeFlags(3, 1, 6, 2) // equipment-class low byte
	visual := EquipVisual{Gid: 100001, RefObjID: 11459, TypeFlags: word, OptLevel: 5}

	payload := visual.Encode()
	if len(payload) != 10 {
		t.Fatalf("equipment visual = %d bytes, want 10 (opt tail present)", len(payload))
	}
	if payload[4] != 0 {
		t.Fatalf("the byte after the gid = %d, want the fixed 0", payload[4])
	}
	if payload[9] != 5 {
		t.Fatalf("opt tail = %d, want 5", payload[9])
	}

	decoded, err := DecodeEquipVisual(payload, word)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if decoded != visual {
		t.Fatalf("round trip = %+v, want %+v", decoded, visual)
	}
}

func TestEquipVisualOmitsTheOptTailOffTheEquipmentClass(t *testing.T) {
	word := PackTypeFlags(3, 3, 5, 0) // ETC low byte: no opt tail
	visual := EquipVisual{Gid: 100001, RefObjID: 62, TypeFlags: word}

	payload := visual.Encode()
	if len(payload) != 9 {
		t.Fatalf("non-equipment visual = %d bytes, want 9 (no opt tail)", len(payload))
	}
	if _, err := DecodeEquipVisual(payload, word); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	// The equipment form must refuse the 9-byte body.
	if _, err := DecodeEquipVisual(payload, PackTypeFlags(3, 1, 6, 2)); err == nil {
		t.Fatal("an equipment-class decode accepted a payload without the opt tail")
	}
}

func TestUnequipVisualIsFixedNineBytes(t *testing.T) {
	clear := UnequipVisual{Gid: 100001, Slot: 6, RefObjID: 0}

	payload := clear.Encode()
	if len(payload) != UnequipVisualSize {
		t.Fatalf("unequip visual = %d bytes, want the fixed %d", len(payload), UnequipVisualSize)
	}
	decoded, err := DecodeUnequipVisual(payload)
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if decoded != clear {
		t.Fatalf("round trip = %+v, want %+v", decoded, clear)
	}
}

// The M1 chain: the visual pushes ride BEHIND the 0xB06D move result.
func TestInventoryMoveFramesOrder(t *testing.T) {
	equip := EquipVisualFrame(EquipVisual{Gid: 100001, RefObjID: 11459, TypeFlags: PackTypeFlags(3, 1, 6, 2), OptLevel: 3})
	clear := UnequipVisualFrame(UnequipVisual{Gid: 100001, Slot: 4})

	frames := InventoryMoveFrames(13, 6, 1, equip, clear)
	assertOpcodeOrder(t, frames, []uint16{OpItemMoveResponse, OpEquipVisual, OpUnequipVisual})

	result, err := DecodeItemMoveResult(frames[0].Payload, 0)
	if err != nil {
		t.Fatalf("move result did not decode: %v", err)
	}
	if result.MovementType != MoveTypeInventory || result.SourceSlot != 13 || result.DestSlot != 6 {
		t.Fatalf("move result = %+v, want the type-0 13->6 row", result)
	}
	if len(result.SubMoves) != 0 {
		t.Fatal("the fixture always answers subMoveCount 0")
	}

	// A bag-only move carries no visuals.
	bagOnly := InventoryMoveFrames(13, 20, 1)
	assertOpcodeOrder(t, bagOnly, []uint16{OpItemMoveResponse})

	if !bytes.Equal(bagOnly[0].Payload, []byte{0x01, 0x00, 13, 20, 0x01, 0x00, 0x00}) {
		t.Fatalf("move row = % X, want [01 00 0D 14 0100 00]", bagOnly[0].Payload)
	}
}
