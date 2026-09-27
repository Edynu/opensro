package enterworld_test

// Store-backed tests for the bootstrap lane's two mutation sites (ADR-1
// S8 first-ever seed, S9 event-guide mask) plus the cross-lane concurrency
// gate: two live characters mutating through ONE real store under -race -
// the workload (asd + asd2 both played) that made the commit door
// necessary (P3 seq 7 Hazard A; REV-4 789/797 evictee window).

import (
	"encoding/binary"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"opensro.online/server/internal/data/store"
	"opensro.online/server/internal/game/action"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"opensro.online/server/internal/game/world/movement"
	"opensro.online/server/internal/game/world/simulation"
)

const doorDivision = enterworld.DefaultDivisionID

// doorSkillSeeder is this suite's stand-in for enterworld.DefaultSkillSeeder
// (the store's unconditional creation-seed invariant refuses an unseeded
// CreateCharacter): the same racial id sets, without a textdata dependency.
func doorSkillSeeder(raceKey string, learned []uint32) ([]uint32, error) {
	ids := []uint32{1, 7127, 7128, 7129, 7909, 7910, 8454, 9069, 9606, 9970}
	if raceKey == enterworld.RaceKeyChina {
		ids = []uint32{1, 2, 40, 70}
	}
	have := make(map[uint32]bool, len(learned))
	for _, id := range learned {
		have[id] = true
	}
	missing := make([]uint32, 0, len(ids))
	for _, id := range ids {
		if !have[id] {
			missing = append(missing, id)
		}
	}
	return missing, nil
}

// doorDeps wires bootstrap deps whose door commits through the given
// store - the server composition, transport-free.
func doorDeps(t *testing.T, authority *store.Store) *enterworld.Deps {
	t.Helper()
	deps := &enterworld.Deps{
		Roster:     &enterworld.Roster{},
		Characters: authority.Characters(),
		Items:      enterworld.NewTextdataItems(filepath.Join(t.TempDir(), "missing-textdata")),
	}
	deps.MutateCharacter = func(c *enterworld.Character, label string, fn func()) {
		// The server wiring's scoped door (ADR-2).
		authority.MutateCharacter(c, label, fn)
	}
	return deps
}

// TestSeedAndMaskSurviveRestart drives S8 and S9 through a real store and
// a fresh hydration.
func TestSeedAndMaskSurviveRestart(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")
	authority, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(authority.Close)
	if err := authority.CreateCharacter(doorDivision, "test-account", &enterworld.Character{
		Name:          "asd2",
		ModelCodename: "CHAR_CH_MAN_ADVENTURER",
	}); err != nil {
		t.Fatalf("CreateCharacter: %v", err)
	}
	deps := doorDeps(t, authority)

	// S8: the first-ever bootstrap seeds inventory + initial gold as ONE
	// commit (the record was created with nil MissionInventory).
	result := enterworld.Build(deps, enterworld.BootstrapRequest{CharacterName: "asd2"})
	if result.NativeResult != 1 {
		t.Fatalf("bootstrap failed: %+v", result)
	}

	// S9: the golden 0x707B mask through the same door.
	live := authority.Characters().CharactersForDivision(doorDivision)[0]
	maskClock := time.Date(2026, 7, 26, 4, 5, 6, 789_000_000, time.UTC)
	if _, err := enterworld.HandleEventGuideAck(deps, live, []byte{0x78, 0x56, 0x34, 0x12}, maskClock); err != nil {
		t.Fatalf("event-guide ack refused: %v", err)
	}

	// The watchdog reboot: the first instance dies (a real reboot never
	// has two live stores - the single-writer guard refuses that), then
	// a fresh store hydrates from the directory alone.
	authority.Close()
	rebooted, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open after reboot: %v", err)
	}
	t.Cleanup(rebooted.Close)
	restored := rebooted.Characters().CharactersForDivision(doorDivision)[0]

	if restored.MissionInventory == nil {
		t.Fatal("after reboot missionInventory is nil - the S8 seed was lost (never-seeded state resurrected)")
	}
	if restored.Gold == nil || *restored.Gold != 0 {
		t.Fatalf("after reboot gold = %v, want the seeded 0", restored.Gold)
	}
	if restored.Mission == nil || restored.Mission.EventGuideStateMask == nil ||
		*restored.Mission.EventGuideStateMask != 0x12345678 {
		t.Fatalf("after reboot mission mask = %+v, want 0x12345678", restored.Mission)
	}
	if got, want := restored.Mission.EventGuideStateMaskUpdatedAt, "2026-07-26T04:05:06.789Z"; got != want {
		t.Fatalf("mask timestamp after reboot = %q, want %q", got, want)
	}

	// The S8 gate on the rebooted store: a second bootstrap must NOT
	// re-seed (missionInventory non-nil = hadInventory true) - the door
	// must not open at all.
	seedCommits := 0
	depsRebooted := &enterworld.Deps{
		Roster:     &enterworld.Roster{},
		Characters: rebooted.Characters(),
		Items:      deps.Items,
	}
	depsRebooted.MutateCharacter = func(_ *enterworld.Character, label string, fn func()) {
		if label == "bootstrap-seed" {
			seedCommits++
		}
		rebooted.Mutate(label, fn)
	}
	second := enterworld.Build(depsRebooted, enterworld.BootstrapRequest{CharacterName: "asd2"})
	if second.NativeResult != 1 {
		t.Fatalf("second bootstrap failed: %+v", second)
	}
	if seedCommits != 0 {
		t.Fatalf("the rebooted bootstrap re-seeded %d time(s); the hadInventory gate must hold across restarts", seedCommits)
	}
	if got := *rebooted.Characters().CharactersForDivision(doorDivision)[0].Gold; got != 0 {
		t.Fatalf("gold after second bootstrap = %d, want untouched 0", got)
	}
}

// TestConcurrentSessionsPersistRace is the two-live-characters gate (run
// under -race): lane A moves + event-guide acks one character while lane B
// storms two-plane item ops on another, EVERY mutation committing through
// ONE real store. Pre-door, the store's marshal raced foreign record
// writes (Hazard A); the door serializes them - this test is the witness,
// and the reboot at the end proves nothing tore.
func TestConcurrentSessionsPersistRace(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "authority")
	authority, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(authority.Close)
	goldB := int64(5000)
	if err := authority.CreateCharacter(doorDivision, "test-account", &enterworld.Character{
		Name: "raceA", ModelCodename: "CHAR_EU_MAN1",
	}); err != nil {
		t.Fatal(err)
	}
	if err := authority.CreateCharacter(doorDivision, "test-account", &enterworld.Character{
		Name: "raceB", ModelCodename: "CHAR_CH_MAN_ADVENTURER", Gold: &goldB,
		MissionInventory: []enterworld.InventoryRow{{
			Slot: 20, RefObjID: 11459, Codename: "ITEM_CH_SWORD_01_A_RARE",
			TypeFlags: wire.PackTypeFlags(3, 1, 6, 2), VarianceBits: "9223372036854775808",
			Durability: 96, StackCount: 1,
		}},
	}); err != nil {
		t.Fatal(err)
	}
	var charA, charB *enterworld.Character
	for _, c := range authority.Characters().CharactersForDivision(doorDivision) {
		switch c.Name {
		case "raceA":
			charA = c
		case "raceB":
			charB = c
		}
	}

	deps := doorDeps(t, authority)
	itemRt := action.NewRuntime(deps, deps.MonsterState)
	moveRt := movement.NewRuntime(deps, itemRt.Worlds)
	authority.AttachGround(itemRt.Ground)
	itemRt.Ground.Restore(authority.GroundSnapshotForRestore())

	euStart := simulation.SeedWorldState(charA).Spawn
	moveBody := func(offset int16) []byte {
		out := make([]byte, 9)
		out[0] = 1
		binary.LittleEndian.PutUint16(out[1:3], euStart.RegionID)
		binary.LittleEndian.PutUint16(out[3:5], uint16(int16(euStart.X)+offset))
		binary.LittleEndian.PutUint16(out[5:7], uint16(int16(euStart.Y)))
		binary.LittleEndian.PutUint16(out[7:9], uint16(int16(euStart.Z)))
		return out
	}

	const rounds = 60
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { // lane A1: moves on raceA (S1)
		defer wg.Done()
		for i := 0; i < rounds; i++ {
			if outcome := moveRt.HandleMove(doorDivision, charA, moveBody(int16(i%40))); outcome.Refusal != nil {
				t.Errorf("move %d refused: %+v", i, outcome.Refusal)
				return
			}
		}
	}()
	go func() { // lane A2: event-guide acks on raceA (S9; the evictee-window pairing)
		defer wg.Done()
		payload := make([]byte, 4)
		for i := 0; i < rounds; i++ {
			binary.LittleEndian.PutUint32(payload, uint32(i))
			if _, err := enterworld.HandleEventGuideAck(deps, charA, payload, time.Now()); err != nil {
				t.Errorf("ack %d refused: %v", i, err)
				return
			}
		}
	}()
	go func() { // lane B: two-plane storms on raceB (S3+S7)
		defer wg.Done()
		for i := 0; i < rounds; i++ {
			var slot uint8
			found := false
			for _, row := range charB.MissionInventory {
				if row.RefObjID == 11459 {
					slot = uint8(row.Slot)
					found = true
					break
				}
			}
			if !found {
				t.Error("lane B lost its sword mid-storm")
				return
			}
			payload, _ := wire.ItemMoveRequest{MovementType: wire.MoveTypeGroundDrop, SourceSlot: slot}.Encode()
			itemRt.HandleItemMove(doorDivision, charB, payload)
			for _, item := range itemRt.Ground.All(doorDivision) {
				if item.RefObjID == 11459 {
					itemRt.HandleTargetInteract(doorDivision, charB, wire.TargetInteract{Gid: item.Gid}.Encode())
					break
				}
			}
		}
	}()
	wg.Wait()

	// The reboot proof: the storm's instance dies first (the single-writer
	// guard refuses a second live store), then hydrate fresh - nothing
	// torn, last writes present.
	authority.Close()
	rebooted, err := store.Open(dir, store.Options{DefaultSkills: doorSkillSeeder})
	if err != nil {
		t.Fatalf("store.Open after the storm: %v", err)
	}
	t.Cleanup(rebooted.Close)
	var restoredA, restoredB *enterworld.Character
	for _, c := range rebooted.Characters().CharactersForDivision(doorDivision) {
		switch c.Name {
		case "raceA":
			restoredA = c
		case "raceB":
			restoredB = c
		}
	}
	if restoredA.World == nil || restoredA.World.Spawn == nil {
		t.Fatal("raceA world lost in the storm")
	}
	if restoredA.Mission == nil || restoredA.Mission.EventGuideStateMask == nil ||
		*restoredA.Mission.EventGuideStateMask != rounds-1 {
		t.Fatalf("raceA mask = %+v, want last-write %d", restoredA.Mission, rounds-1)
	}
	swordInBag := 0
	for _, row := range restoredB.MissionInventory {
		if row.RefObjID == 11459 {
			swordInBag++
		}
	}
	swordOnGround := 0
	for _, rows := range rebooted.GroundSnapshotForRestore().Divisions {
		for _, row := range rows {
			if row.RefObjID == 11459 {
				swordOnGround++
			}
		}
	}
	if swordInBag+swordOnGround != 1 {
		t.Fatalf("sword exactly-once violated after the storm: bag %d + ground %d", swordInBag, swordOnGround)
	}
	if restoredB.Gold == nil || *restoredB.Gold != 5000 {
		t.Fatalf("raceB gold = %v, want untouched 5000", restoredB.Gold)
	}
	if health := rebooted.Health(); health.LoadedFromBak {
		t.Fatalf("storm degraded the store: %+v", health)
	}
}
