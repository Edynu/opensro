/*
===========================================================================

evaluate.go - replaying block writes into a parameter keeper

===========================================================================
*/

package abnormal

import "opensro.online/server/internal/game/paramkeeper"

/*
==================
ApplyTo

ApplyTo replays the block's writes for one parameter on a keeper element
that already holds the owner's own contributions (its base as flat source
zero). A block write keyed by source zero replaces that base entry, as
frostbite's write to parameter 8C does natively.
==================
*/
func (b *Block) ApplyTo(param uint16, element *paramkeeper.Element) error {
	for _, m := range b.Modifiers {
		if !m.Used || m.Param != param {
			continue
		}
		if _, err := element.Apply(paramkeeper.Channel(m.Channel), m.Source, m.Value); err != nil {
			return err
		}
	}
	return nil
}

/*
==================
Evaluate

Evaluate computes a parameter from its definition and base plus the block's
writes. Owners with further contributions build their own element and use
ApplyTo instead.
==================
*/
func (b *Block) Evaluate(param uint16, definition paramkeeper.Definition, base float32) (float32, error) {
	element, err := paramkeeper.New(definition)
	if err != nil {
		return 0, err
	}
	if _, err = element.Apply(paramkeeper.Flat, 0, base); err != nil {
		return 0, err
	}
	if err = b.ApplyTo(param, element); err != nil {
		return 0, err
	}
	return element.Value()
}

// Touches reports whether the block writes one parameter.
func (b *Block) Touches(param uint16) bool {
	for _, m := range b.Modifiers {
		if m.Used && m.Param == param {
			return true
		}
	}
	return false
}
