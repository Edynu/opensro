// Package paramkeeper evaluates the shared native parameter modifier algebra.
// Elements are local to a stat projection; they are not a second live effect or
// character authority. Effect admission, lifetime and persistence stay with
// their existing owners.
package paramkeeper

import (
	"fmt"
	"math"
	"sort"
)

// Channel is the bucket index used by 4B3000 and 4B2E60. In particular,
// Flat replaces the fallback base with the sum of its entries; it is not an
// increment to that base. PercentProduct accepts percentage deltas, whereas
// FactorProduct accepts factors expressed with 100 as the identity.
type Channel uint8

const (
	Flat Channel = iota
	PercentSum
	PercentProduct
	FactorProduct
	channelCount
)

// Definition corresponds to CParam's +20/+24/+28/+2C initialization in 4B2F40.
// Ignore is an insertion no-op sentinel, not a request to erase an older value.
type Definition struct {
	Minimum, Maximum, Base, Ignore float32
}

// Element must not be copied after use. Source keys are opaque uint32 identities
// supplied by the projection owner, ordered unsigned as in 4B39D2..4B39D7.
// Native uses source pointers: assigning port identities and reconstructing
// native source order are responsibilities of the eventual stat graph owner.
type Element struct {
	definition Definition
	buckets    [channelCount]map[uint32]float32
}

func New(definition Definition) (*Element, error) {
	for _, v := range []float32{definition.Minimum, definition.Maximum, definition.Base, definition.Ignore} {
		if !finite(v) {
			return nil, fmt.Errorf("paramkeeper: non-finite definition")
		}
	}
	if definition.Minimum > definition.Maximum {
		return nil, fmt.Errorf("paramkeeper: minimum exceeds maximum")
	}
	return &Element{definition: definition}, nil
}

// Apply inserts or replaces one source, not the entire channel (4B2D60).
// The result reports whether a write occurred, even if the value is unchanged;
// native also dirties and propagates unchanged non-sentinel writes.
func (p *Element) Apply(channel Channel, source uint32, value float32) (bool, error) {
	if channel >= channelCount || !finite(value) {
		return false, fmt.Errorf("paramkeeper: invalid channel %d or non-finite modifier", channel)
	}
	if value == p.definition.Ignore { // 4B3019: ordered equality only
		return false, nil
	}
	if p.buckets[channel] == nil {
		p.buckets[channel] = make(map[uint32]float32)
	}
	p.buckets[channel][source] = value
	return true, nil
}

// Remove returns the native OR of channel+1 for every bucket that contained
// the source (4B2E00/4B31A0), not a channel bitset. A zero return means no change.
// Empty buckets remain allocated: deleting the last Flat entry leaves a zero
// sum and does not restore Definition.Base.
func (p *Element) Remove(source uint32) uint8 {
	var removed uint8
	for channel, bucket := range p.buckets {
		if _, ok := bucket[source]; ok {
			delete(bucket, source)
			removed |= uint8(channel + 1)
		}
	}
	return removed
}

// Value follows the store boundaries in 4B3210. Wider intermediates precede
// explicit float32 stores; this portable implementation is not an x87 bit-
// equivalence certificate. Invalid/overflowing projections fail explicitly.
func (p *Element) Value() (float32, error) {
	values := [channelCount]float32{p.definition.Base, 0, 0, 100}
	allocated := false
	for channel, bucket := range p.buckets {
		if bucket != nil {
			allocated = true
			values[channel] = reduce(Channel(channel), bucket)
			if !finite(values[channel]) {
				return 0, fmt.Errorf("paramkeeper: channel %d overflow", channel)
			}
		}
	}
	if !allocated { // 4B3277..4B3287: fallback bypasses the clamp
		return p.definition.Base, nil
	}
	value := float32((float64(values[PercentSum]) + 100) * float64(values[Flat]) / 100)
	if values[PercentProduct] != 0 {
		if value == 0 { // 4B32C7..4B32DF: equality, not positivity
			value = values[PercentProduct]
		} else {
			value = float32(float64(value) * float64(values[PercentProduct]))
		}
	}
	value = float32((float64(values[FactorProduct]) / 100) * float64(value))
	if !finite(value) {
		return 0, fmt.Errorf("paramkeeper: result overflow")
	}
	if value < p.definition.Minimum {
		value = p.definition.Minimum
	} else if value > p.definition.Maximum {
		value = p.definition.Maximum
	}
	return value, nil
}

func reduce(channel Channel, bucket map[uint32]float32) float32 {
	keys := make([]uint32, 0, len(bucket))
	for key := range bucket {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	var result float32
	if channel == FactorProduct {
		result = 100
	}
	for _, key := range keys {
		value := float64(bucket[key])
		switch channel {
		case Flat, PercentSum:
			result = float32(float64(result) + value)
		case PercentProduct:
			factor := 1 + value/100
			if result != 0 {
				factor *= float64(result)
			}
			result = float32(factor)
		case FactorProduct:
			result = float32(value * float64(result) / 100)
		}
	}
	return result
}

func finite(value float32) bool {
	return !math.IsInf(float64(value), 0) && !math.IsNaN(float64(value))
}
