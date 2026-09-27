package inventory

import "testing"

func TestSlotBands(t *testing.T) {
	cases := []struct {
		wireSlot  uint8
		equipment bool
		bag       bool
		valid     bool
	}{
		{0, true, false, true},
		{12, true, false, true},
		{13, false, true, true},
		{44, false, true, true},
		{45, false, false, false},
		{255, false, false, false},
	}

	for _, testCase := range cases {
		if got := IsEquipmentSlot(testCase.wireSlot); got != testCase.equipment {
			t.Fatalf("IsEquipmentSlot(%d) = %v, want %v", testCase.wireSlot, got, testCase.equipment)
		}
		if got := IsBagSlot(testCase.wireSlot); got != testCase.bag {
			t.Fatalf("IsBagSlot(%d) = %v, want %v", testCase.wireSlot, got, testCase.bag)
		}
		if got := IsValidSlot(testCase.wireSlot); got != testCase.valid {
			t.Fatalf("IsValidSlot(%d) = %v, want %v", testCase.wireSlot, got, testCase.valid)
		}
	}
}

// The composer biases bag slots by 13, so bag index 0 travels as wire slot 13.
func TestBagSlotBiasRoundTrips(t *testing.T) {
	if got := WireSlotFromBagIndex(0); got != 13 {
		t.Fatalf("bag index 0 = wire slot %d, want 13", got)
	}
	if got := WireSlotFromBagIndex(31); got != 44 {
		t.Fatalf("bag index 31 = wire slot %d, want 44", got)
	}

	for bagIndex := uint8(0); bagIndex < BagCapacity; bagIndex++ {
		wireSlot := WireSlotFromBagIndex(bagIndex)
		got, ok := BagIndexFromWireSlot(wireSlot)
		if !ok {
			t.Fatalf("wire slot %d did not map back to a bag index", wireSlot)
		}
		if got != bagIndex {
			t.Fatalf("wire slot %d = bag index %d, want %d", wireSlot, got, bagIndex)
		}
	}
}

func TestBagIndexRejectsEquipmentSlots(t *testing.T) {
	if _, ok := BagIndexFromWireSlot(12); ok {
		t.Fatal("equipment wire slot 12 was accepted as a bag slot")
	}
	if _, ok := BagIndexFromWireSlot(45); ok {
		t.Fatal("out-of-range wire slot 45 was accepted as a bag slot")
	}
}

func TestBagCapacityMatchesTheEntryBlock(t *testing.T) {
	// The 0x32B3 local-player entry block ships a capacity byte of 45 covering
	// 13 equipment sockets plus the bag.
	if got := EquipmentSlotEnd + BagCapacity; got != BagSlotEnd {
		t.Fatalf("equipment + bag = %d, want %d", got, BagSlotEnd)
	}
	if BagCapacity != 32 {
		t.Fatalf("bag capacity = %d, want 32", BagCapacity)
	}
}

func TestSocketAcceptsRingInEitherHand(t *testing.T) {
	if !SocketAccepts(SocketRing, SocketRing) {
		t.Fatal("a ring was refused by its own socket")
	}
	if !SocketAccepts(SocketRing, SocketRingSecond) {
		t.Fatal("a ring was refused by the second ring hand")
	}
	if SocketAccepts(SocketWeapon, SocketShield) {
		t.Fatal("a weapon was accepted by the shield socket")
	}
	if SocketAccepts(SocketNecklace, SocketRingSecond) {
		t.Fatal("a necklace was accepted by the second ring hand")
	}
}
