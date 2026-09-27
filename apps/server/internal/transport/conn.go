package transport

import "context"

// Conn is one live client connection, either a WebTransport session or a
// WebSocket. Both implementations pump inbound frames on an internal
// goroutine so ReadFrame is a plain blocking call with context cancel.
//
// WriteFrame is not safe for concurrent use; the session's single write
// loop is the only caller. WriteUnreliable IS safe from any goroutine on
// connections that support it (QUIC datagrams).
type Conn interface {
	// ReadFrame blocks until a frame arrives, the context is done, or the
	// connection dies. After an error the connection is unusable.
	ReadFrame(ctx context.Context) (Frame, error)
	// WriteFrame sends one frame on the reliable, ordered channel.
	WriteFrame(f Frame) error
	// SupportsUnreliable reports whether WriteUnreliable actually is
	// unreliable-datagram based on this connection.
	SupportsUnreliable() bool
	// WriteUnreliable sends a frame as a datagram, best effort. Only valid
	// when SupportsUnreliable.
	WriteUnreliable(f Frame) error
	// Close tears the connection down. reason is best-effort diagnostics.
	Close(reason string) error
	// Kind is "webtransport" or "websocket", for logs and metrics.
	Kind() string
	// RemoteAddr describes the peer, for logs.
	RemoteAddr() string
}
