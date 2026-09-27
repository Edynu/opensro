package monster

// Opponent is one of the two native AI records at +BC/+D0 (stride 20).
// Damage and aggression are distinct accumulators. HitCount wraps as a byte.
type Opponent struct {
	GID        uint32
	Damage     uint32
	Aggression int32
	Flags      uint8
	HitCount   uint8
	LastHitMs  uint32
}

type OpponentCandidate struct {
	GID      uint32
	Eligible bool
	Distance float64
}

// RecordOpponentHit is 5473C0's record update followed by 548090/545680's
// selection. The caller supplies current entity resolution and distance;
// this value operation owns neither entity lookup nor movement publication.
func RecordOpponentHit(records *[2]Opponent, policy uint8, attacker uint32, damage uint32, aggression, percent int32, now, cadence uint32, candidates [3]OpponentCandidate) uint32 {
	slot := 2
	for i := range records {
		if records[i].GID == 0 || records[i].GID == attacker {
			slot = i
			r := &records[i]
			r.GID = attacker
			r.Damage += damage
			r.HitCount++
			// IMUL truncates to 32 bits before signed division by 100.
			r.Aggression += (percent * r.Aggression) / 100
			r.Aggression += aggression
			if r.Aggression < 0 {
				r.Aggression = 0
			}
			r.LastHitMs = now
			break
		}
	}
	primary := records[0].GID
	if slot == 0 && records[0].Aggression <= 0 {
		return 0 // callback refused: retain the mover's existing ownership
	}
	switch policy {
	case 1:
		if primary != attacker {
			// 53FFE0 changes the primary identity/time, not the score bytes.
			records[0].GID, records[0].LastHitMs = attacker, now
		}
		return attacker
	case 2:
		if slot == 0 {
			return primary
		}
		lookup := func(gid uint32) OpponentCandidate {
			for _, c := range candidates {
				if c.GID == gid {
					return c
				}
			}
			return OpponentCandidate{}
		}
		first := lookup(primary)
		if slot == 1 {
			second := lookup(records[1].GID)
			if !first.Eligible {
				records[0], records[1] = records[1], Opponent{}
				if second.Eligible {
					return records[0].GID
				}
				return 0
			}
			if second.Eligible && (records[1].Aggression > records[0].Aggression || now-records[0].LastHitMs >= cadence*2) {
				records[0], records[1] = records[1], records[0]
				records[0].LastHitMs = now
			}
			return records[0].GID
		}
		incoming := lookup(attacker)
		if !incoming.Eligible {
			return primary
		}
		if !first.Eligible || incoming.Distance < first.Distance {
			if first.Eligible {
				records[1] = records[0]
			}
			records[0] = Opponent{GID: attacker, HitCount: 1, LastHitMs: now}
			return attacker
		}
	}
	return primary
}
