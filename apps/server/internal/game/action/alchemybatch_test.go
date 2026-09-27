package action

import (
	"encoding/binary"
	"testing"
	"time"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/alchemy"
	"opensro.online/server/internal/game/item/wire"
)

func compoundBatchRuntime() (*Runtime, *enterworld.Character, *[]wire.Frame) {
	rt, c := alchemyRuntime()
	rt.Now = func() time.Time { return time.UnixMilli(100000) }
	rt.Alchemy.Items["part"] = alchemy.Reference{ID: 10, Name: "part", Flags: 0x25ec, Stack: 250, Params: [5]uint32{1, 1, 1, 1}, Descriptions: [5]string{"e", "w", "f", "a"}}
	rt.Alchemy.Items["ITEM_ETC_ARCHEMY_RONDO_01"] = alchemy.Reference{ID: 11, Name: "ITEM_ETC_ARCHEMY_RONDO_01", Flags: 0x35ec, Stack: 5000}
	for k, name := range []string{"e", "w", "f", "a"} {
		rt.Alchemy.Items[name] = alchemy.Reference{ID: uint32(20 + k), Name: name, Flags: 0x2dec, Stack: 5000}
	}
	c.MissionInventory = []enterworld.InventoryRow{
		{Slot: 13, RefObjID: 11, Codename: "ITEM_ETC_ARCHEMY_RONDO_01", TypeFlags: 0x35ec, StackCount: 20},
		{Slot: 14, RefObjID: 10, Codename: "part", TypeFlags: 0x25ec, StackCount: 2},
		{Slot: 15, RefObjID: 10, Codename: "part", TypeFlags: 0x25ec, StackCount: 4},
		{Slot: 16, RefObjID: 10, Codename: "part", TypeFlags: 0x25ec, StackCount: 7},
	}
	var delivered []wire.Frame
	rt.PushCharacterFrames = func(_, _ string, frames []wire.Frame) { delivered = append(delivered, frames...) }
	return rt, c, &delivered
}

func startCompoundBatch(rt *Runtime, c *enterworld.Character) []wire.Frame {
	return rt.HandleAlchemyProcess(testDivision, c, alchemy.OpCompound, []byte{2, 1, 9, 0, 0, 0, 4, 13, 14, 15, 16})
}
func quantityAt(c *enterworld.Character, slot int64) int64 {
	for _, row := range c.Snapshot().MissionInventory {
		if row.Slot == slot {
			return row.StackCount
		}
	}
	return 0
}

func TestCompoundBatchCommitsOrderedStacksAcrossCharacterUpdates(t *testing.T) {
	rt, c, delivered := compoundBatchRuntime()
	first := startCompoundBatch(rt, c)
	if got := binary.LittleEndian.Uint32(first[len(first)-1].Payload[2:]); got != 2 {
		t.Fatal(got)
	}
	if quantityAt(c, 15) != 4 || quantityAt(c, 16) != 7 {
		t.Fatal("first response consumed future steps")
	}
	for _, now := range []int64{100001, 101000, 101001, 102000, 103000} {
		rt.advanceCompoundJobs(now)
	}
	if len(*delivered) != 0 {
		t.Fatal("early or duplicate update advanced batch")
	}
	rt.advanceCompoundJobs(104000)
	if quantityAt(c, 16) != 7 || quantityAt(c, 13) != 14 {
		t.Fatal("second step consumed wrong quantity", c.MissionInventory)
	}
	for _, now := range []int64{105000, 106000, 107000} {
		rt.advanceCompoundJobs(now)
	}
	if quantityAt(c, 16) != 4 || quantityAt(c, 13) != 11 {
		t.Fatal("total applied to each stack instead of whole request", c.MissionInventory)
	}
	if _, busy := rt.compoundJob(compoundKey{testDivision, c.Name}); busy {
		t.Fatal("completed job retained")
	}
	var counts []uint32
	for _, frame := range *delivered {
		if frame.Opcode == alchemy.OpCompoundResult {
			counts = append(counts, binary.LittleEndian.Uint32(frame.Payload[2:]))
		}
	}
	if len(counts) != 2 || counts[0] != 4 || counts[1] != 3 {
		t.Fatal(counts)
	}
}

func TestCompoundBatchCancellationRemovalAndInputReplacement(t *testing.T) {
	for _, reason := range []string{"cancel", "disconnect", "replace", "death"} {
		t.Run(reason, func(t *testing.T) {
			rt, c, delivered := compoundBatchRuntime()
			startCompoundBatch(rt, c)
			if frames := startCompoundBatch(rt, c); len(frames) != 0 {
				t.Fatal("duplicate request restarted batch")
			}
			switch reason {
			case "cancel":
				rt.HandleAlchemyProcess(testDivision, c, alchemy.OpCompound, []byte{1})
			case "disconnect":
				rt.ForgetCharacter(testDivision, c.Name)
			case "replace":
				for i := range c.MissionInventory {
					if c.MissionInventory[i].Slot == 15 {
						c.MissionInventory[i].RefObjID = 999
					}
				}
			case "death":
				hp := int64(0)
				c.CurrentHP = &hp
			}
			for _, now := range []int64{101000, 102000, 103000, 104000, 200000} {
				rt.advanceCompoundJobs(now)
			}
			if quantityAt(c, 13) != 18 || quantityAt(c, 16) != 7 {
				t.Fatal("retired job consumed inventory", c.MissionInventory)
			}
			if _, busy := rt.compoundJob(compoundKey{testDivision, c.Name}); busy {
				t.Fatal("terminal job retained")
			}
			if reason == "cancel" || reason == "disconnect" {
				if len(*delivered) != 0 {
					t.Fatal("late reply after cleanup")
				}
			} else if len(*delivered) == 0 {
				t.Fatal("failure did not release client operation")
			}
		})
	}
}

func TestCompoundClockRetainsNativeElapsedDebtWithoutBurstingOneUpdate(t *testing.T) {
	job := compoundJob{lastMs: 100000}
	var due bool
	job, due = compoundClock(job, 110000)
	if due || job.counter != 1 || job.elapsedSeconds != 9 {
		t.Fatal(job, due)
	}
	unchanged, fired := compoundClock(job, 110000)
	if fired || unchanged.counter != job.counter || unchanged.elapsedSeconds != job.elapsedSeconds {
		t.Fatal("duplicate update drained elapsed debt")
	}
	for _, now := range []int64{110001, 110002} {
		job, due = compoundClock(job, now)
		if due {
			t.Fatal("counter advanced more than once per update")
		}
	}
	job, due = compoundClock(job, 110003)
	if !due || job.counter != 1 || job.elapsedSeconds < 6 {
		t.Fatal("overdue callback was discarded", job, due)
	}
}
