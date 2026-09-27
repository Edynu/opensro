package eventdispatch

import "testing"

func TestRegistrationRetainsDisabledHandlersUntilOwnerClear(t *testing.T) {
	a, b := &Receiver{OrderKey: 0x80000009}, &Receiver{OrderKey: 1}
	g := &Registry{}
	h1, h2, h3 := NewHandler(1), NewHandler(1), NewHandler(1)
	a.Register(0, 12, h1, g)
	b.Register(0, 12, h2, g)
	a.Register(2, -1, h3, nil)
	g.RemoveFirstPhaseZeroEvent12()
	if h2.Enabled != 0 || h1.Enabled != 1 || len(g.entries) != 1 || b.IsAbsent(0, 12) {
		t.Fatal("first unsigned receiver key or retention")
	}
	g.Clear()
	if h1.Enabled != 0 || h3.Enabled != 1 || a.IsAbsent(0, 12) {
		t.Fatal("external registry cleanup")
	}
	var destroyed []*Handler
	a.Clear(func(h *Handler) {
		if h.Enabled != 0 {
			t.Fatal("destroy before embedded registry cleanup")
		}
		destroyed = append(destroyed, h)
	})
	if len(destroyed) != 2 || destroyed[0] != h1 || destroyed[1] != h3 || !a.IsAbsent(0, 12) {
		t.Fatal("receiver ownership")
	}
}
func TestResultFourUsesActualRegistryRemoval(t *testing.T) {
	r := &Receiver{OrderKey: 1}
	h0, h1 := NewHandler(1), NewHandler(1)
	r.Register(0, 2, h0, nil)
	r.Register(0, 2, h1, nil)
	p := &probe{h: [2]*Handler{h0, h1}, now: 2, result: 4}
	if r.Dispatch(0, 2, p) != 4 || h0.Enabled != 0 || h1.Enabled != 1 || len(r.own.entries) != 1 || p.invoked != 1 {
		t.Fatal("unregister did not detach before exit")
	}
	// Receiver presence survives disable, but only the remaining handler executes.
	if r.Dispatch(0, 2, p) != 0 || p.invoked != 3 {
		t.Fatal("disabled entry replayed")
	}
}
func TestRegisterKeepsDisabledAndSignedKeyOrder(t *testing.T) {
	r := &Receiver{OrderKey: 1}
	a, b, c := NewHandler(1), NewHandler(1), NewHandler(1)
	b.Enabled = 0
	r.Register(1, 4, a, nil)
	r.Register(1, -1, b, nil)
	r.Register(1, 4, c, nil)
	if r.phases[1][0] != b || r.phases[1][1] != a || r.phases[1][2] != c || b.Enabled != 0 {
		t.Fatal("registration reordered or re-enabled")
	}
	global := &Receiver{OrderKey: 2}
	if IsAbsentEverywhere(global, r, 1, -1) {
		t.Fatal("disabled handler presence ignored")
	}
}
