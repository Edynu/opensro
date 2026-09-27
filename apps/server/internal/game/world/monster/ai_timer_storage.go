package monster

import "unique"

// StoredAITimers separates per-actor clocks from commonly identical immutable
// timer configuration. It preserves the complete manager, including selection
// identity and armed flags. It never consumes a timer or random draw.
type StoredAITimers struct {
	clocks [12]uint32
	shape  unique.Handle[AITimeManager]
}

func (m AITimeManager) Store() StoredAITimers {
	var s StoredAITimers
	for i := range m.first {
		s.clocks[i] = m.first[i].LastCheckMs
		m.first[i].LastCheckMs = 0
	}
	for i := range m.second {
		s.clocks[9+i] = m.second[i].LastCheckMs
		m.second[i].LastCheckMs = 0
	}
	s.shape = unique.Make(m)
	return s
}

func (s StoredAITimers) Restore() AITimeManager {
	m := s.shape.Value()
	for i := range m.first {
		m.first[i].LastCheckMs = s.clocks[i]
	}
	for i := range m.second {
		m.second[i].LastCheckMs = s.clocks[9+i]
	}
	return m
}
