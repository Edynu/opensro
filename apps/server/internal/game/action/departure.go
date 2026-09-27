package action

import (
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/grounditem"
	"opensro.online/server/internal/transport"
)

// v1.188 50EFF0 -> 50EF70 explicit request: ordinary five-second delay.
// Wire identifiers and byte widths are the v1.150 client's 700020/74B2E0.
const departureSeconds = 5

type pendingDeparture struct {
	session             *transport.Session
	division, character string
	due                 int64
}

func (rt *Runtime) registerDeparture(hub *transport.Hub) {
	hub.Handle(0x70b7, func(s *transport.Session, _ uint16, p []byte) {
		c, division, bound := enterworld.SessionCharacter(rt.deps, s)
		if !bound || len(p) != 1 || (p[0] != 1 && p[0] != 2) {
			_ = s.Send(0xb0b7, []byte{2, 1})
			return
		}
		unlock := rt.lockDivision(division)
		if s.Evicted() {
			unlock()
			return
		}
		if !s.WorldReady() {
			unlock()
			_ = s.Send(0xb0b7, []byte{2, 2})
			return
		}
		// 50EF70 first cancels the actor's current action through vtable +6A8.
		rt.ClearCombatIntent(division, c.Name)
		rt.Pending.Clear(grounditem.PendingKey(division, c.Name))
		rt.departureMu.Lock()
		if rt.departures == nil {
			rt.departures = make(map[uint64]pendingDeparture)
		}
		rt.departures[s.ID] = pendingDeparture{session: s, division: division, character: c.Name, due: rt.Now().UnixMilli() + departureSeconds*1000}
		rt.departureMu.Unlock()
		unlock()
		// A queue refusal can synchronously invoke both close hooks below and
		// gameplay cleanup. Neither departure nor division locks may be held.
		_ = s.Send(0xb0b7, []byte{1, departureSeconds, p[0]})
	})
	hub.OnSessionClose(func(s *transport.Session, _ error) {
		rt.departureMu.Lock()
		delete(rt.departures, s.ID)
		rt.departureMu.Unlock()
	})
}

func (rt *Runtime) advanceDepartures(now int64) {
	rt.departureMu.Lock()
	var due []pendingDeparture
	for id, job := range rt.departures {
		select {
		case <-job.session.Done():
			delete(rt.departures, id)
			continue
		default:
		}
		if job.session.Evicted() {
			delete(rt.departures, id)
			continue
		}
		if now >= job.due {
			due = append(due, job)
		}
	}
	rt.departureMu.Unlock()
	for _, job := range due {
		unlock := rt.lockDivision(job.division)
		rt.departureMu.Lock()
		current, pending := rt.departures[job.session.ID]
		if !pending || current.due > now {
			rt.departureMu.Unlock()
			unlock()
			continue
		}
		delete(rt.departures, job.session.ID)
		rt.departureMu.Unlock()
		closeSession := false
		division, name, bound := job.session.CharacterBinding()
		if bound && !job.session.Evicted() && division == job.division && name == job.character {
			// Queue completion before orderly transport closure. The normal close hook
			// owns presence, companions, effects and character-world retirement.
			closeSession = true
		}
		unlock()
		// Detached closure AND send-overflow invoke teardown synchronously.
		// Publish outside the transaction; Send still rejects an evicted owner.
		if closeSession && job.session.Send(0x315a, nil) == nil {
			job.session.CloseWhenDrained(transport.ByeReasonNormal)
		}
	}
}
