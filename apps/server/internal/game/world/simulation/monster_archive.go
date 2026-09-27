package simulation

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"opensro.online/server/internal/game/world/monster"
	"os"
	"unique"
)

const monsterArchiveSlotBytes = 8192

// This process-local backing store is not a respawn source. Slots hold the
// exact existing actor snapshot and are recycled on wake/death. The population
// mutex owns all I/O and indexes; shutdown closes it only after readers drain.
type monsterArchive struct {
	file   *os.File
	next   int64
	free   []int64
	failed bool
}
type archivedMonster struct {
	slot      int64
	ref       unique.Handle[monster.MonsterRef]
	rarity    uint8
	hp, maxHP uint32
}
type frozenMonster struct {
	Ref     monster.MonsterRef
	Nest    monster.NestRow
	Spawn   monster.SpawnPoint
	Heading uint16
	HP      uint32
}

func (f frozenMonster) value(gid uint32) monster.Instance {
	return monster.Instance{Gid: gid, Ref: f.Ref, Nest: f.Nest, Spawn: f.Spawn, SpawnHeading: f.Heading, CurrentHP: f.HP}
}

func (s *MonsterState) EnableDormantStorage() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.archive != nil {
		return fmt.Errorf("dormant storage already installed")
	}
	f, err := os.CreateTemp("", "sro-monsters-*.bin")
	if err != nil {
		return err
	}
	s.archive = &monsterArchive{file: f}
	for _, key := range s.populationKeys() {
		s.populationForLease(key.division, key.lease).instances.archive = s.archive
	}
	return nil
}
func (s *MonsterState) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.archive == nil || s.archive.file == nil {
		return nil
	}
	f := s.archive.file
	s.archive.file = nil
	err := f.Close()
	if removeErr := os.Remove(f.Name()); err == nil {
		err = removeErr
	}
	return err
}
func (a *monsterArchive) put(row monster.Instance) (archivedMonster, bool) {
	f := frozenMonster{row.Ref, row.Nest, row.Spawn, row.SpawnHeading, row.CurrentHP}
	// Never drop commands, wounds, effects or any future Instance field.
	if a.failed || row.Rarity()&15 == 3 || f.value(row.Gid) != row {
		return archivedMonster{}, false
	}
	data, err := json.Marshal(f)
	if err != nil || len(data) > monsterArchiveSlotBytes-4 {
		return archivedMonster{}, false
	}
	slot := a.next
	if n := len(a.free); n > 0 {
		slot = a.free[n-1]
		a.free = a.free[:n-1]
	} else {
		a.next += monsterArchiveSlotBytes
	}
	record := make([]byte, 4+len(data))
	binary.LittleEndian.PutUint32(record, uint32(len(data)))
	copy(record[4:], data)
	if n, err := a.file.WriteAt(record, slot); err != nil || n != len(record) {
		a.free = append(a.free, slot)
		a.failed = true
		return archivedMonster{}, false
	}
	return archivedMonster{slot: slot, ref: unique.Make(row.Ref), rarity: row.Rarity(), hp: row.CurrentHP, maxHP: row.EffectiveMaxHP()}, true
}
func (a *monsterArchive) get(gid uint32, r archivedMonster) monster.Instance {
	var header [4]byte
	if _, err := a.file.ReadAt(header[:], r.slot); err != nil {
		panic(fmt.Sprintf("dormant monster read: %v", err))
	}
	n := binary.LittleEndian.Uint32(header[:])
	if n == 0 || n > monsterArchiveSlotBytes-4 {
		panic("invalid dormant monster record")
	}
	data := make([]byte, n)
	if _, err := a.file.ReadAt(data, r.slot+4); err != nil {
		panic(fmt.Sprintf("dormant monster read: %v", err))
	}
	var f frozenMonster
	if err := json.Unmarshal(data, &f); err != nil {
		panic(fmt.Sprintf("dormant monster decode: %v", err))
	}
	return f.value(gid)
}
