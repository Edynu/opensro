package agentserver

import (
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestPasswordFailureBudgetCountsOnlyFailuresAndResets(t *testing.T) {
	var failures passwordFailures
	now := time.Date(2026, 9, 9, 0, 0, 0, 0, time.UTC)
	for count := uint32(1); count <= passwordFailureLimit; count++ {
		got, ok := failures.update("127.0.0.1:1", "tester", now, true, false)
		if !ok || got != passwordFailureLimit<<16|count {
			t.Fatalf("count %d: %x %v", count, got, ok)
		}
	}
	got, _ := failures.update("127.0.0.1:2", "tester", now, false, false)
	if got != passwordFailureLimit<<16|passwordFailureLimit {
		t.Fatalf("ports must share budget: %x", got)
	}
	got, _ = failures.update("127.0.0.1:2", "other", now, false, false)
	if got&0xffff != 0 {
		t.Fatal("different account shared failures")
	}
	got, _ = failures.update("127.0.0.2:2", "tester", now, false, false)
	if got&0xffff != 0 {
		t.Fatal("different client shared failures")
	}
	got, _ = failures.update("127.0.0.1", "tester", now.Add(passwordFailureWindow), true, false)
	if got&0xffff != 1 {
		t.Fatalf("expiry failed: %x", got)
	}
	failures.update("127.0.0.1", "tester", now.Add(passwordFailureWindow), false, true)
	got, _ = failures.update("127.0.0.1", "tester", now.Add(passwordFailureWindow), true, false)
	if got&0xffff != 1 {
		t.Fatalf("success reset failed: %x", got)
	}
}

func TestPasswordFailureBudgetIsBoundedUnderConcurrentFailures(t *testing.T) {
	var failures passwordFailures
	now := time.Now()
	var workers sync.WaitGroup
	for i := 0; i < 32; i++ {
		workers.Add(1)
		go func() { defer workers.Done(); failures.update("client", "account", now, true, false) }()
	}
	workers.Wait()
	got, _ := failures.update("client", "account", now, false, false)
	if got&0xffff != passwordFailureLimit {
		t.Fatalf("count exceeded budget: %x", got)
	}
	for i := 0; i < maxLoginClientBuckets-1; i++ {
		failures.entries[passwordFailureKey{"client", string(rune(i + 1))}] = passwordFailureState{1, now.Add(time.Minute)}
	}
	if _, ok := failures.update("client", "new account", now, true, false); ok {
		t.Fatal("unbounded active tracker")
	}
	if _, ok := failures.update("client", "new account", now.Add(time.Minute), true, false); !ok {
		t.Fatal("expired trackers were not released")
	}
}

func TestLoginPublishesAuthoritativePasswordArguments(t *testing.T) {
	fixture := newAgentFixture(t, http.NotFoundHandler(), http.NotFoundHandler())
	publishFixtureLease(t, fixture, "alpha", "worker-a", 1, 0)
	login := func(password string) map[string]any {
		response := performJSON(t, fixture.handler, http.MethodPost, "/title/login", `{"id":"tester","password":"`+password+`","serverId":"alpha"}`, "")
		return decodeObject(t, response)
	}
	for count := 1; count <= 2; count++ {
		body := login("wrong")
		if body["nativeTitleStatus"] != float64(2) || body["nativeTitleArgument"] != float64(passwordFailureLimit<<16|count) {
			t.Fatalf("native failure: %v", body)
		}
	}
	if login("123123")["ok"] != true {
		t.Fatal("valid login failed")
	}
	if login("wrong")["nativeTitleArgument"] != float64(passwordFailureLimit<<16|1) {
		t.Fatal("authenticated account retained failures")
	}
}
