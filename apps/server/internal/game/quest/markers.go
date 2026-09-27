package quest

import (
	"encoding/binary"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/wire"
	"sort"
)

// MarkerStates derives presentation from the same acceptance and objective
// predicates as the quest transaction. Call under the character read door.
// A quest names one current NPC; native 787DB0 resolves competing rows by
// ascending quest key, not by a browser-side severity heuristic.
func (rt *Runtime) MarkerStates(c *enterworld.Character) map[uint32]NpcMarker {
	out := make(map[uint32]NpcMarker)
	if c == nil || c.DeletePending {
		return out
	}
	country := enterworld.NativeCountryByte9C(c)
	level := int64(1)
	if c.Level != nil {
		level = *c.Level
	}
	for _, def := range rt.Defs.All() {
		if def.StartNpcCodename == "" || (def.CountryByte != 3 && int(def.CountryByte) != country) || int64(def.Level) > level {
			continue
		}
		at := activeQuestIndex(c, def.RefID)
		if at < 0 {
			// 925D20 calls condition slot +11C with arg4=1: the marker
			// checks the hour but bypasses the first-come quota (926B01).
			if canAcceptAgain(c, def) && prerequisitesMet(c, def) && rt.calendarAvailable(def, true) {
				out[def.RefID] = NpcMarker{Codename: def.StartNpcCodename, State: 1}
			}
			continue
		}
		record := c.ActiveQuests[at]
		current := def
		if len(def.Stages) > 0 {
			var ok bool
			current, ok = definitionAtStage(def, record.Stage)
			if !ok {
				continue
			}
		}
		npc := current.EndNpcCodename
		state := uint8(2)
		if stageObjectiveMet(c, current, record) {
			state = 3
		}
		if current.DeliveryNpcCodename != "" && heldCollectCount(c, current) < current.CollectCount {
			npc = current.DeliveryNpcCodename
			state = 3
		}
		if npc != "" {
			out[def.RefID] = NpcMarker{Codename: npc, State: state}
		}
	}
	return out
}

type NpcMarker struct {
	Codename string
	State    uint8
}

// MarkerPublication is private to one admitted transport session. Only changed
// records cross the wire; reconnect creates a new publication, including when
// the preceding connection never received its final delta.
type MarkerPublication struct{ rows map[uint32][18]byte }

func (p *MarkerPublication) Update(rows map[uint32][18]byte) []wire.Frame {
	ids := make([]uint32, 0, len(rows)+len(p.rows))
	seen := make(map[uint32]bool)
	for id := range rows {
		ids = append(ids, id)
		seen[id] = true
	}
	for id := range p.rows {
		if !seen[id] {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	var out []wire.Frame
	for _, id := range ids {
		next, present := rows[id]
		previous, existed := p.rows[id]
		if !present {
			payload := make([]byte, 4)
			binary.LittleEndian.PutUint32(payload, id)
			out = append(out, wire.Frame{Opcode: 0x30ea, Payload: payload})
		} else if !existed || next != previous {
			out = append(out, wire.Frame{Opcode: 0x3498, Payload: append([]byte(nil), next[:]...)})
		}
	}
	p.rows = rows
	return out
}

// Native 75C0F0: key, flags, effect-state, region, three i16 coordinates,
// optional NPC object gid when flags&2. This is not the journal tracked ID.
func EncodeNpcMarker(id, gid uint32, state uint8, region uint16, x, y, z int16) [18]byte {
	var p [18]byte
	binary.LittleEndian.PutUint32(p[:], id)
	p[4] = 2
	p[5] = state
	binary.LittleEndian.PutUint16(p[6:], region)
	binary.LittleEndian.PutUint16(p[8:], uint16(x))
	binary.LittleEndian.PutUint16(p[10:], uint16(y))
	binary.LittleEndian.PutUint16(p[12:], uint16(z))
	binary.LittleEndian.PutUint32(p[14:], gid)
	return p
}
