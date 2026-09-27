package agentapi

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestStartOwnsListenerBeforeReturning(t *testing.T) {
	api, _ := newTestAPI(t)
	serveError, err := api.Start("127.0.0.1:0")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := api.Shutdown(shutdownContext); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	select {
	case err := <-serveError:
		if !errors.Is(err, http.ErrServerClosed) {
			t.Fatalf("serve error = %v, want http.ErrServerClosed", err)
		}
	case <-time.After(time.Second):
		t.Fatal("serve goroutine did not stop")
	}
}

func TestStartReportsBindFailureSynchronously(t *testing.T) {
	blocker, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve address: %v", err)
	}
	defer blocker.Close()

	api, _ := newTestAPI(t)
	if _, err := api.Start(blocker.Addr().String()); err == nil {
		t.Fatal("Start succeeded on an occupied address")
	}
}

func TestStartRefusesPublicPlaintextListener(t *testing.T) {
	api, _ := newTestAPI(t)
	if _, err := api.Start("0.0.0.0:0"); err == nil {
		t.Fatal("agent API accepted a public plaintext listener")
	}
}

func TestStartAllowsExplicitPrivateNetworkListener(t *testing.T) {
	api, _ := newTestAPI(t)
	api.privateNetwork = true
	serveError, err := api.Start("0.0.0.0:0")
	if err != nil {
		t.Fatalf("private network Start: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := api.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-serveError; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve error = %v", err)
	}
}

func TestHTTPServerCarriesResourceLimits(t *testing.T) {
	api, _ := newTestAPI(t)
	serveError, err := api.Start("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server, _ := api.listener.current()
	if server.ReadHeaderTimeout <= 0 ||
		server.ReadTimeout <= 0 ||
		server.WriteTimeout <= 0 ||
		server.IdleTimeout <= 0 ||
		server.MaxHeaderBytes <= 0 {
		t.Fatalf("HTTP limits incomplete: %+v", server)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := api.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-serveError; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve error = %v", err)
	}
}
