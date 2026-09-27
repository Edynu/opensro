package main

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFollowFixtureCommandsWaitForCoordinatorAndReturnDetachedReply(t *testing.T) {
	c := &followFixtureControl{requests: make(chan followFixtureRequest, 8), active: make(map[string]*liveFollowFixture)}
	result := make(chan followFixtureReply, 1)
	go func() {
		value, err := c.command("test", "asd2", "cleanup")
		result <- followFixtureReply{value: value, err: err}
	}()
	request := <-c.requests
	select {
	case <-result:
		t.Fatal("HTTP command executed outside coordinator")
	default:
	}
	c.requests <- request
	c.tick(time.Now().UnixMilli())
	reply := <-result
	if reply.err != nil {
		t.Fatal(reply.err)
	}
	raw, ok := reply.value.(json.RawMessage)
	if !ok || string(raw) != `{"cleaned":true}` {
		t.Fatalf("reply escaped as mutable owner state: %#v", reply.value)
	}
}

func TestFollowFixtureExpiredCommandCannotMutateAfterTimeout(t *testing.T) {
	c := &followFixtureControl{requests: make(chan followFixtureRequest, 8), active: make(map[string]*liveFollowFixture)}
	request := followFixtureRequest{command: "create", expires: time.Now().Add(-time.Second), reply: make(chan followFixtureReply, 1)}
	c.requests <- request
	// There is deliberately no gameplay capability: admitting create would fail.
	c.tick(time.Now().UnixMilli())
	if reply := <-request.reply; reply.err == nil {
		t.Fatal("expired command admitted")
	}
	if len(c.active) != 0 {
		t.Fatal("expired command left fixture state")
	}
}
