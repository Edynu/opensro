// Package calendar owns the world-server calendar and native wire encoding.
package calendar

import (
	"encoding/binary"
	"time"
)

// SR_GameServer 427660 initializes one world clock with scale=30 and zero
// seed seconds; 427720 divides elapsed milliseconds by floor(30000/1440).
// 4e3eb0 serializes the existing calendar at login. No login-local epoch,
// wall-clock date, or month modulo occurs in these intervals.
const MillisecondsPerGameSecond int64 = 20

// One immutable process-lifetime epoch, shared by both clock packet producers.
// time.Since retains Go's monotonic component, matching GetTickCount's role.
var startedAt = time.Now()

type Value struct {
	Day          uint16
	Hour, Minute uint8
}

func AtElapsedMilli(elapsed int64) Value {
	if elapsed < 0 {
		elapsed = 0
	}
	seconds := elapsed / MillisecondsPerGameSecond
	return Value{Day: uint16(seconds / 86400), Hour: uint8(seconds / 3600 % 24), Minute: uint8(seconds / 60 % 60)}
}
func Current() Value { return AtElapsedMilli(time.Since(startedAt).Milliseconds()) }
func (v Value) Payload() []byte {
	payload := make([]byte, 4)
	binary.LittleEndian.PutUint16(payload, v.Day)
	payload[2], payload[3] = v.Hour, v.Minute
	return payload
}
