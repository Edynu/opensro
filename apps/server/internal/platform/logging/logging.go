// Package logging owns this server's logrus setup.
//
// It replaces the framework's logging.Init rather than wrapping it: that
// version's timestamp layout is "2006-01-01 15:04:05.000", and since Go's
// reference date is Mon Jan 2 15:04:05 2006, the "01" in the day position
// renders the MONTH a second time. Every line it emitted carried a wrong
// date - July 27 printed as 2026-07-07 - which reads as correct only while
// the day happens to equal the month. That silently misleads anyone
// correlating a log line against a file mtime, a process start time or
// another service, which is exactly when a log's clock matters.
//
// Overriding the formatter after calling the framework's Init would leave
// two copies of the same settings drifting apart across upgrades, so the
// gateway owns them here instead and never calls that function. The level
// still comes from the same "log.level" key, which the gateway's own
// config.Initialize defaults and binds to LOG_LEVEL.
package logging

import (
	"os"

	log "github.com/sirupsen/logrus"
	"github.com/spf13/viper"
	"opensro.online/server/internal/config"
)

// TimestampLayout is the gateway's log timestamp layout. The day MUST be
// "02"; see the package comment for the bug this replaces.
const TimestampLayout = "2006-01-02 15:04:05.000"

// Formatter builds the gateway's log formatter. Logs are supervisor-owned
// files, so ANSI terminal colour bytes are always disabled: operators and
// tooling should see plain UTF-8 text.
func Formatter() *log.TextFormatter {
	return &log.TextFormatter{
		DisableColors:   true,
		FullTimestamp:   true,
		TimestampFormat: TimestampLayout,
	}
}

// InstallFormat installs the output and formatter only, with no dependency
// on config. Call it before config.Initialize: that function logs, and
// anything emitted before the formatter is installed comes out in logrus'
// default shape instead of TimestampLayout - two odd lines at the top of
// every boot, in the one place a log-shape grep is most likely to start.
func InstallFormat() {
	log.SetOutput(os.Stdout)
	log.SetFormatter(Formatter())
}

// Init installs the gateway's log output, formatter and level. Call it after
// config.Initialize so the configured level is already loaded.
func Init() {
	InstallFormat()

	configured := viper.GetString(config.LogLevel)
	level, err := log.ParseLevel(configured)
	if err != nil {
		// The framework reported its zero-value level here instead of the
		// offending input, which named the wrong thing in the one message
		// that exists to tell an operator what they mistyped.
		log.Warnf("logging: unparseable log level %q - falling back to info", configured)
		level = log.InfoLevel
	}
	log.SetLevel(level)
}
