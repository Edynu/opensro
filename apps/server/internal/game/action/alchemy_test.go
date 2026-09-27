package action

import (
	"errors"
	"reflect"
	"sync"
	"testing"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/alchemy"
	"opensro.online/server/internal/game/item/wire"
)

func alchemyRuntime() (*Runtime, *enterworld.Character) {
	character := testCharacter()
	rt, _ := newTestRuntime(character, testItems())
	weapon := character.MissionInventory[0]
	rt.Alchemy = &alchemy.Catalog{Items: map[string]alchemy.Reference{
		weapon.Codename: {ID: weapon.RefObjID, Name: weapon.Codename, Flags: weapon.TypeFlags, Class: 1, MaxMagic: 9},
		"elixir":        {ID: 2, Name: "elixir", Flags: wire.PackTypeFlags(3, 3, 10, 1), Params: [5]uint32{6 << 24, 420744970, 168430090, 168101125}},
	}, Magic: map[uint16]alchemy.Magic{}}
	character.MissionInventory = append(character.MissionInventory, enterworld.InventoryRow{Slot: 21, RefObjID: 2, Codename: "elixir", TypeFlags: wire.PackTypeFlags(3, 3, 10, 1), StackCount: 1})
	rt.AlchemyRoll = func() (uint32, error) { return 0, nil }
	return rt, character
}

func TestAlchemyConcurrentAttemptsCannotSpendOneElixirTwice(t *testing.T) {
	rt, character := alchemyRuntime()
	var wg sync.WaitGroup
	results := make(chan []wire.Frame, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- rt.HandleAlchemyReinforce(testDivision, character, []byte{2, 20, 21})
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for frames := range results {
		last := frames[len(frames)-1]
		if last.Opcode != alchemy.OpReinforceResult {
			t.Fatal("wrong reply family")
		}
		if last.Payload[0] == 1 {
			wins++
			if len(frames) != 2 || frames[0].Opcode != 0x3645 || !reflect.DeepEqual(frames[0].Payload, []byte{21, 8, 0, 0}) {
				t.Fatalf("material/result ordering %+v", frames)
			}
		}
	}
	if wins != 1 || len(character.MissionInventory) != 1 || character.MissionInventory[0].Plus != 1 {
		t.Fatalf("double spend: wins=%d inventory=%+v", wins, character.MissionInventory)
	}
}

func TestAlchemyEntropyFailureCannotMutateOrClaimSuccess(t *testing.T) {
	rt, character := alchemyRuntime()
	before := append([]enterworld.InventoryRow(nil), character.MissionInventory...)
	rt.AlchemyRoll = func() (uint32, error) { return 0, errors.New("entropy failed") }
	frames := rt.HandleAlchemyReinforce(testDivision, character, []byte{2, 20, 21})
	if !reflect.DeepEqual(character.MissionInventory, before) || len(frames) != 1 || frames[0].Payload[0] == 1 {
		t.Fatal("failed transaction changed inventory or published success")
	}
}

func TestAlchemyPreservesUnrelatedPersistedFields(t *testing.T) {
	rt, character := alchemyRuntime()
	legacy := enterworld.InventoryRow{Slot: 30, RefObjID: 999, Codename: "unrelated", VarianceBits: "000123", StackCount: 0}
	character.MissionInventory = append(character.MissionInventory, legacy)
	rt.HandleAlchemyReinforce(testDivision, character, []byte{2, 20, 21})
	if !reflect.DeepEqual(character.MissionInventory[1], legacy) {
		t.Fatalf("unrelated row normalized: %+v", character.MissionInventory[1])
	}
}

func TestAlchemyMalformedAndDuplicateSlotsDoNotDraw(t *testing.T) {
	rt, character := alchemyRuntime()
	rt.AlchemyRoll = func() (uint32, error) { t.Fatal("invalid request drew randomness"); return 0, nil }
	for _, p := range [][]byte{nil, {3, 20, 21}, {2, 20, 20}, {2, 0, 21}, {2, 20, 21, 0}} {
		frames := rt.HandleAlchemyReinforce(testDivision, character, p)
		if len(frames) != 1 || frames[0].Payload[0] == 1 {
			t.Fatalf("accepted %x", p)
		}
	}
}
