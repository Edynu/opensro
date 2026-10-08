/*
===========================================================================

peer_reference_catalog.go - immutable peer item metadata prepared before ticks

The bounded item catalogue can read backing files on a cache miss. Resolve
and encode public reference rows during composition, before the simulation
starts. Visibility then copies only the demanded rows from this projection;
it never performs catalogue I/O while holding the division tick lock.

===========================================================================
*/
package action

import (
	"encoding/json"
	"fmt"

	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/world/simulation"
)

/*
================
PeerReferenceCatalog

Only public item metadata is retained, not combat records or inventories.
Rows are immutable after construction. Every returned frame owns its bytes.
================
*/
type PeerReferenceCatalog struct {
	rows map[uint32]json.RawMessage
}

/*
================
PreparePeerItemReferences

The complete item identity list comes from the same authored catalogue used
by the operator item composer. Use the existing reference encoder so spawn,
equipment changes and purchases publish exactly the same schema and fields.
An incomplete projection is a startup error, never a silent runtime fallback.
================
*/
func (rt *Runtime) PreparePeerItemReferences(items []enterworld.ItemCommandReference) (*PeerReferenceCatalog, error) {
	catalog := &PeerReferenceCatalog{rows: make(map[uint32]json.RawMessage, len(items))}
	seen := make(map[uint32]bool, len(items))
	for len(items) > 0 {
		n := min(len(items), maxReferencesPerFrame)
		ids := make([]uint32, 0, n)
		for _, item := range items[:n] {
			if item.RefObjID == 0 || seen[item.RefObjID] {
				return nil, fmt.Errorf("invalid peer item identity %d", item.RefObjID)
			}
			seen[item.RefObjID] = true
			ids = append(ids, item.RefObjID)
		}
		for _, frame := range rt.itemReferencesByID(ids) {
			var delta struct {
				Items []json.RawMessage `json:"items"`
			}
			if err := json.Unmarshal(frame.Payload, &delta); err != nil {
				return nil, fmt.Errorf("prepare peer item references: %w", err)
			}
			for _, row := range delta.Items {
				var identity struct {
					ID uint32 `json:"refObjId"`
				}
				if err := json.Unmarshal(row, &identity); err != nil {
					return nil, fmt.Errorf("prepare peer item identity: %w", err)
				}
				catalog.rows[identity.ID] = row
			}
		}
		for _, id := range ids {
			if _, ok := catalog.rows[id]; !ok {
				return nil, fmt.Errorf("peer item reference %d could not be resolved", id)
			}
		}
		items = items[n:]
	}
	return catalog, nil
}

/*
================
Frames

No disk access, reference lookup, or retained mutable output in the tick.
Keep first-seen order, deduplication and the existing per-frame row bound.
================
*/
func (c *PeerReferenceCatalog) Frames(ids []uint32) []simulation.Frame {
	rows := make([]json.RawMessage, 0, len(ids))
	seen := make(map[uint32]bool, len(ids))
	for _, id := range ids {
		if row, ok := c.rows[id]; ok && !seen[id] {
			seen[id] = true
			rows = append(rows, row)
		}
	}
	var frames []simulation.Frame
	for len(rows) > 0 {
		n := min(len(rows), maxReferencesPerFrame)
		// The rows were marshalled and parsed during construction; they are
		// immutable valid JSON, so this encoding cannot fail.
		payload, err := json.Marshal(struct {
			Version int               `json:"version"`
			Items   []json.RawMessage `json:"items"`
		}{1, rows[:n]})
		if err != nil {
			panic(err)
		}
		frames = append(frames, simulation.Frame{Opcode: opCommerceItemReferences, Payload: payload})
		rows = rows[n:]
	}
	return frames
}
