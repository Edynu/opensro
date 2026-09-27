package monster

import "testing"

func TestTargetStatusObserverBranches(t *testing.T) {
	for raw := 0; raw < 256; raw++ {
		status := uint8(raw)
		for _, actor := range []uint16{0xc6, 0x1c6, 0x11c6, 0x186, 0x1c4} {
			for _, flags := range []uint32{0, 0x200, 0x80000200} {
				want := actor == 0x1c6 || actor == 0x11c6
				if !want {
					switch status {
					case 2, 3, 4:
						want = false
					case 6, 7:
						want = flags&0x200 != 0
					default:
						want = true
					}
				}
				if got := AllowsTargetStatus(actor, flags, status); got != want {
					t.Fatalf("actor=%x flags=%x status=%d got=%v want=%v", actor, flags, status, got, want)
				}
			}
		}
	}
}
