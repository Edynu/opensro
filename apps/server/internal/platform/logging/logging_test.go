package logging

import (
	"strings"
	"testing"
	"time"

	log "github.com/sirupsen/logrus"
)

// TestFormatterRendersTheRealDayOfMonth is the guard for the bug this
// package exists to fix. The framework's layout put the month token in the
// day position, so a wrong layout still LOOKS right whenever the day equals
// the month - the reference instant below deliberately uses day 27 of month
// 07 so the two cannot be confused.
func TestFormatterRendersTheRealDayOfMonth(t *testing.T) {
	when := time.Date(2026, time.July, 27, 2, 27, 9, 632000000, time.UTC)

	line, err := Formatter().Format(&log.Entry{
		Time:    when,
		Level:   log.InfoLevel,
		Message: "store: authority ready",
	})
	if err != nil {
		t.Fatalf("format: %v", err)
	}

	if got := string(line); !strings.Contains(got, "2026-07-27 02:27:09.632") {
		t.Fatalf("formatted line does not carry the real date\n got: %q\nwant it to contain: %q", got, "2026-07-27 02:27:09.632")
	}
	// The specific wrong rendering the framework produced, pinned so a
	// regression names itself instead of just failing the match above.
	if got := string(line); strings.Contains(got, "2026-07-07") {
		t.Fatalf("day position is rendering the month again (the framework bug is back): %q", got)
	}
}

// TestTimestampLayoutUsesTheDayToken fails on the exact character that was
// wrong, so the diff needed to fix a regression is unambiguous.
func TestTimestampLayoutUsesTheDayToken(t *testing.T) {
	if TimestampLayout != "2006-01-02 15:04:05.000" {
		t.Fatalf("TimestampLayout = %q; the day MUST be 02 (01 is Go's month token)", TimestampLayout)
	}
}

func TestFormatterProducesPlainFileFriendlyText(t *testing.T) {
	f := Formatter()
	if !f.DisableColors || !f.FullTimestamp {
		t.Fatalf("formatter must emit timestamped text without terminal colours: %+v", f)
	}
	line, err := f.Format(&log.Entry{
		Time:    time.Date(2026, time.July, 30, 1, 2, 3, 0, time.UTC),
		Level:   log.WarnLevel,
		Message: "plain log",
	})
	if err != nil {
		t.Fatalf("format: %v", err)
	}
	if strings.Contains(string(line), "\x1b[") {
		t.Fatalf("formatted file log contains ANSI escape bytes: %q", line)
	}
}
