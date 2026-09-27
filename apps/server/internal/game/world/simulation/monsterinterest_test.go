package simulation

import (
	"testing"

	"opensro.online/server/internal/game/item/wire"
	worldgeom "opensro.online/server/internal/game/world"
	"opensro.online/server/internal/game/world/instance"
	"opensro.online/server/internal/game/world/monster"
)

func scopeStreamInstance(t *testing.T, registry *MonsterState, regionID uint16, x float64) monster.Instance {
	t.Helper()
	registry.StartDivision(monsterTestDivision)
	registry.AdvancePopulation(registry.CurrentTimeMillis())
	for _, instance := range registry.InstancesInRegions(monsterTestDivision, []uint16{regionID}) {
		if instance.Spawn.X == x {
			return instance
		}
	}
	t.Fatalf("no fixture instance at region %#04x x=%v", regionID, x)
	return monster.Instance{}
}

// The region ring still materializes every candidate, but only the native
// 3x3 block neighbourhood is visible: a same-region monster two blocks away
// is not admitted (the former whole-region ring admitted it).
func TestMonsterInterestIsNarrowerThanTheMaterializationRing(t *testing.T) {
	ops, regionA, _ := scopeStreamFixture(t)
	viewer := worldgeom.RegionXZ{RegionID: regionA, X: 1000, Z: 100} // block X=99
	ops.Monsters.StartDivision(monsterTestDivision)
	ops.Monsters.AdvancePopulation(ops.Monsters.CurrentTimeMillis())
	if got := len(ops.Monsters.InstancesInRegions(monsterTestDivision, RegionScopeRing(regionA))); got != 3 {
		t.Fatalf("ring candidates = %d, want all 3 fixture monsters", got)
	}
	if got := ops.Monsters.InterestInstances(monsterTestDivision, viewer, 0); len(got) != 0 {
		t.Fatalf("interest admitted %d monsters from blocks 96 and 102, want none", len(got))
	}

	push := &fakePusher{}
	ops.RunMonsterLeg(1_784_000_000_000, []SessionSnapshot{viewerSessionAt(regionA, 1000)}, push)
	if frames := sessionFrames(push, "viewer"); len(frames) != 0 {
		t.Fatalf("viewer outside every monster's neighbourhood received %d frames", len(frames))
	}
}

// Block membership reads the mover's live position, not the nest anchor.
func TestMonsterInterestFollowsTheLivePose(t *testing.T) {
	ops, regionA, _ := scopeStreamFixture(t)
	registry := ops.Monsters
	instance := scopeStreamInstance(t, registry, regionA, 100)
	mover, _ := registry.Mover(monsterTestDivision, instance.Gid)
	if err := mover.Transition(monster.MoverEventSpawnHoldElapsed, 0); err != nil {
		t.Fatalf("seed idle mover: %v", err)
	}
	if err := mover.Transition(monster.MoverEventStartWander, 0); err != nil {
		t.Fatalf("transition wander: %v", err)
	}
	from := monster.Pose{RegionID: regionA, X: 100, Y: 10, Z: 100}
	mover.From, mover.Pose = from, from
	mover.To = monster.Pose{RegionID: regionA, X: 1000, Y: 10, Z: 100}
	mover.DepartMs, mover.ArriveMs = 0, 10_000
	registry.CommitMover(monsterTestDivision, instance.Gid, mover)

	viewer := worldgeom.RegionXZ{RegionID: regionA, X: 100, Z: 100} // block X=96
	visible := func(nowMs int64) bool {
		for _, candidate := range registry.InterestInstances(monsterTestDivision, viewer, nowMs) {
			if candidate.Gid == instance.Gid {
				return true
			}
		}
		return false
	}
	if !visible(5_000) { // live x=550, block 97
		t.Fatal("monster one block from the viewer must be visible")
	}
	if visible(8_000) { // live x=820, block 98, anchor still in block 96
		t.Fatal("monster two blocks from the viewer must leave interest while its anchor stays inside")
	}
}

// The client holds exactly the recorded bootstrap object list, so the first
// scope tick reconciles against it: a recorded monster now outside interest
// is removed, an unrecorded visible monster is created, and a recorded
// visible monster is left alone.
func TestFirstSightReconcilesAgainstTheRecordedObjectList(t *testing.T) {
	const t0 = int64(1_784_000_000_000)
	ops, regionA, regionB := scopeStreamFixture(t)
	a1 := scopeStreamInstance(t, ops.Monsters, regionA, 100)
	a2 := scopeStreamInstance(t, ops.Monsters, regionA, 200)
	b := scopeStreamInstance(t, ops.Monsters, regionB, 200)
	session := viewerSessionAt(regionA, 100) // block 96: sees A1 and A2, not B
	ops.Monsters.RecordObjectList(monsterTestDivision, PlayerObjectID(session.CharacterID), []uint32{a1.Gid, b.Gid})

	push := &fakePusher{}
	ops.RunMonsterLeg(t0, []SessionSnapshot{session}, push)
	created := 0
	var removed []uint32
	for _, frame := range scopeDeltaFrames(push, "viewer") {
		switch frame.Opcode {
		case wire.OpSingleObjectSpawn:
			created++
		case wire.OpObjectDespawn:
			despawn, err := wire.DecodeObjectDespawn(frame.Payload)
			if err != nil {
				t.Fatalf("despawn decode: %v", err)
			}
			removed = append(removed, despawn.Gid)
		default:
			t.Fatalf("unexpected scope delta %#04x", frame.Opcode)
		}
	}
	if created != 1 || len(removed) != 1 || removed[0] != b.Gid {
		t.Fatalf("first-sight deltas created=%d removed=%v, want one create (A2) and B removed", created, removed)
	}
	shown := ops.shownMonsters["viewer"]
	if !shown[a1.Gid] || !shown[a2.Gid] || shown[b.Gid] || len(shown) != 2 {
		t.Fatalf("shown after reconciliation = %v, want exactly A1 and A2", shown)
	}
	if _, ok := ops.Monsters.TakeObjectList(monsterTestDivision, PlayerObjectID(session.CharacterID)); ok {
		t.Fatal("the bootstrap record must be consumed by first sight")
	}
}

// ---- the Q2 scoped visibility stream ----

// scopeStreamFixture: regionA holds two nests in block X=96 (sector 16,
// local block 0) and regionB one nest in block X=102 (sector 17, local block
// 0), all on block row Z=96. A viewer walking east along z=100 sees the A pair
// first, then B enters across the region seam, then A leaves.
func scopeStreamFixture(t *testing.T) (*MonsterMoverOps, uint16, uint16) {
	t.Helper()
	regionA := RegionIDForSectors(16, 16)
	regionB := RegionIDForSectors(17, 16)
	refs := map[uint32]monster.MonsterRef{
		1933: {RefObjID: 1933, TidWord: 0x00C6, Codename: "MOB_CH_MANGNYANG", MonsterType: 3, WalkSpeed: 8, RunSpeed: 22, ScaleDenom: 100},
	}
	template := monster.TemplateFromParts(refs, []monster.NestRow{
		{SpawnPoint: monster.SpawnPoint{RefObjID: 1933, RegionID: regionA, X: 100, Y: 10, Z: 100}},
		{SpawnPoint: monster.SpawnPoint{RefObjID: 1933, RegionID: regionA, X: 200, Y: 10, Z: 150}},
		{SpawnPoint: monster.SpawnPoint{RefObjID: 1933, RegionID: regionB, X: 200, Y: 10, Z: 100}},
	})
	registry := NewMonsterState(template)
	registry.StartDivision(monsterTestDivision)
	registry.AdvancePopulation(registry.CurrentTimeMillis())
	registry.StartDivision(monsterTestDivision)
	registry.AdvancePopulation(1784000000000)
	return &MonsterMoverOps{
		Monsters:   registry,
		TacticsFor: fixedTactics(passiveTactics()),
		Rand:       func() float64 { return 0.5 },
	}, regionA, regionB
}

func viewerSessionAt(regionID uint16, x float64) SessionSnapshot {
	world := WorldState{Spawn: Spawn{RegionID: regionID, X: x, Y: 10, Z: 100}, SpawnSet: true}
	return SessionSnapshot{SessionID: "viewer", DivisionID: monsterTestDivision, CharacterID: 7, World: world, WorldInstance: 0x10001, Population: instance.Lease{ID: instance.Pack(1, 1), Generation: 1}}
}

func sessionFrames(push *fakePusher, sessionID string) []Frame {
	var out []Frame
	for _, pushed := range push.toSession {
		if pushed.sessionID == sessionID {
			out = append(out, pushed.frames...)
		}
	}
	return out
}

// The scoped visibility stream end to end over native 320-unit interest
// blocks: first sight seeds silently (the bootstrap list already delivered
// the interest set); a STATIONARY viewer emits ZERO deltas (coordinator
// seq401 condition 3); moving within the same neighbourhood emits nothing;
// jumping east makes regionB's monster enter across the region seam as one
// 0x30D7 single WITH the appear tail while regionA's two monsters leave as ONE
// byListSub=2 bracket; a single-monster exit uses the 0x36AB single.
func TestMonsterScopeStreamDeltas(t *testing.T) {
	const t0 = int64(1_784_000_000_000)
	ops, regionA, regionB := scopeStreamFixture(t)
	push := &fakePusher{}

	// Tick 1 @ block X=96: seed - regionA's 2 monsters in scope, NO scope
	// deltas emitted (bootstrap already delivered the interest set; mover
	// goal frames for the shown monsters are legitimate and ignored here).
	session := viewerSessionAt(regionA, 100)
	recordTestMonsterBootstrap(ops, []SessionSnapshot{session}, t0)
	ops.RunMonsterLeg(t0, []SessionSnapshot{session}, push)
	if frames := scopeDeltaFrames(push, "viewer"); len(frames) != 0 {
		t.Fatalf("seed tick emitted %d scope deltas, want 0 (bootstrap already delivered the interest set)", len(frames))
	}

	// Ticks 2-4, stationary: ZERO scope deltas (the seq401 C3 canary).
	for i := int64(1); i <= 3; i++ {
		ops.RunMonsterLeg(t0+i*250, []SessionSnapshot{session}, push)
	}
	if frames := scopeDeltaFrames(push, "viewer"); len(frames) != 0 {
		t.Fatalf("stationary viewer received %d scope deltas, want 0 (spawn/despawn churn without movement is a bug)", len(frames))
	}

	// Tick 5 @ block X=97: the neighbourhood is 96-98, so A stays and B
	// (102) is still out of interest.
	session = viewerSessionAt(regionA, 400)
	ops.RunMonsterLeg(t0+1000, []SessionSnapshot{session}, push)
	if frames := scopeDeltaFrames(push, "viewer"); len(frames) != 0 {
		t.Fatalf("block-97 viewer emitted %d scope deltas, want 0 (A still visible, B not yet)", len(frames))
	}

	// Tick 6 @ block X=101 (regionA's last block): the neighbourhood is
	// 100-102, so regionB's monster ENTERS across the seam and regionA's pair
	// EXITS in the same step - one 0x30D7 single with the vt+0x68 appear tail
	// in, the two A-monsters out as one bracket.
	session = viewerSessionAt(regionA, 1700)
	ops.RunMonsterLeg(t0+1250, []SessionSnapshot{session}, push)
	frames := scopeDeltaFrames(push, "viewer")
	var singles, brackets, despawnSingles int
	for _, frame := range frames {
		switch frame.Opcode {
		case wire.OpSingleObjectSpawn:
			singles++
			// The single MUST end with the appear byte (WIP C3): create
			// row + 1.
			if frame.Payload[len(frame.Payload)-1] != MonsterAppearByte {
				t.Fatalf("0x30D7 single does not end with the appear byte: % X", frame.Payload)
			}
			if frame.Payload[len(frame.Payload)-2] != 3 {
				t.Fatalf("0x30D7 scope-enter rarity = %d, want instance rarity 3", frame.Payload[len(frame.Payload)-2])
			}
		case opObjectListStart:
			brackets++
			if frame.Payload[0] != 0x02 {
				t.Fatalf("bracket byListSub = %#02x, want 0x02 (despawn group)", frame.Payload[0])
			}
			if count := int(frame.Payload[1]) | int(frame.Payload[2])<<8; count != 2 {
				t.Fatalf("bracket count = %d, want 2 (both regionA monsters)", count)
			}
		case wire.OpObjectDespawn:
			despawnSingles++
		}
	}
	if singles != 1 || brackets != 1 || despawnSingles != 0 {
		t.Fatalf("block-101 deltas: %d singles / %d brackets / %d despawn-singles, want 1/1/0 (B enters, A pair leaves as a bracket)", singles, brackets, despawnSingles)
	}

	// Tick 7 @ block X=104 (regionB local block 2): B (102) exits alone ->
	// ONE 0x36AB single.
	push.toSession = nil
	session = viewerSessionAt(regionB, 740)
	ops.RunMonsterLeg(t0+1500, []SessionSnapshot{session}, push)
	frames = scopeDeltaFrames(push, "viewer")
	if len(frames) != 1 || frames[0].Opcode != wire.OpObjectDespawn {
		t.Fatalf("single exit frames = %+v, want exactly one 0x36AB", frames)
	}

	// Departed session: bookkeeping must not leak.
	ops.RunMonsterLeg(t0+1750, nil, push)
	if len(ops.shownMonsters) != 0 {
		t.Fatalf("shownMonsters retains %d departed sessions", len(ops.shownMonsters))
	}
}
