package action

import (
	"fmt"
	"opensro.online/server/internal/game/enterworld"
	"opensro.online/server/internal/game/item/commerce"
	"strings"
)

type merchantTaxKey struct {
	division string
	merchant uint32
}
type merchantTax struct {
	tax    commerce.Tax
	exempt map[int64]bool
}

// SetCommerceTax is the server authority boundary for a merchant's rate and
// owning/allied guilds. No native request is allowed to provide these values.
// An absent row means no configured tax, not an inferred fortress schedule.
func (rt *Runtime) SetCommerceTax(division string, merchant uint32, percent int16, precision uint, exemptGuilds []int64) error {
	if division == "" || strings.TrimSpace(division) != division || merchant == 0 || precision != 24 && precision != 53 && precision != 64 {
		return fmt.Errorf("invalid merchant tax authority")
	}
	row := merchantTax{tax: commerce.Tax{Percent: percent, Precision: precision}, exempt: map[int64]bool{}}
	for _, gid := range exemptGuilds {
		if gid <= 0 {
			return fmt.Errorf("invalid exempt guild")
		}
		row.exempt[gid] = true
	}
	rt.commercePolicyMu.Lock()
	defer rt.commercePolicyMu.Unlock()
	if rt.commerceTaxes == nil {
		rt.commerceTaxes = map[merchantTaxKey]merchantTax{}
	}
	rt.commerceTaxes[merchantTaxKey{division, merchant}] = row
	return nil
}
func (rt *Runtime) commerceTax(division string, merchant uint32, c *enterworld.Character) commerce.Tax {
	rt.commercePolicyMu.RLock()
	defer rt.commercePolicyMu.RUnlock()
	row := rt.commerceTaxes[merchantTaxKey{division, merchant}]
	tax := row.tax
	if c != nil && c.GuildID != nil {
		tax.Exempt = row.exempt[*c.GuildID]
	}
	return tax
}

// A logical player lifetime owns the ledger. Rebinding/resuming the same
// transport lifetime preserves it; replacing that lifetime clears it. The
// native server clears PC+2008 during initialization and pooled PC reset.
func (rt *Runtime) BeginCommerceSession(division string, c *enterworld.Character, session uint64) {
	if c == nil || session == 0 {
		return
	}
	unlock := rt.lockDivision(division)
	defer unlock()
	rt.deps.Update(c, "buyback-session-begin", func() bool {
		if c.BuybackSession == session {
			return false
		}
		c.Buyback = nil
		c.BuybackSession = session
		return true
	})
}
func (rt *Runtime) EndCommerceSession(division string, c *enterworld.Character, session uint64) {
	if c == nil || session == 0 {
		return
	}
	unlock := rt.lockDivision(division)
	defer unlock()
	rt.deps.Update(c, "buyback-session-end", func() bool {
		if c.BuybackSession != session {
			return false
		}
		c.Buyback = nil
		c.BuybackSession = 0
		return true
	})
}
