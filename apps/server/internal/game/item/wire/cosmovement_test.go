package wire

import "testing"

func TestCosMovementFormsRejectTruncationAndKeepNativeTail(t *testing.T) {
	for _, tail := range [][]byte{{1, 79, 107, 1, 0, 80, 0, 22, 0}, {0, 1, 255, 255}} {
		p := append([]byte{3, 0, 192, 0, 1}, tail...)
		q, err := DecodeCosCommand(p)
		if err != nil || q.CosGid != 0xc00003 || q.Tag != 1 || len(q.Movement) != len(tail) {
			t.Fatalf("decode %+v %v", q, err)
		}
		for i := 0; i < len(p); i++ {
			if _, err := DecodeCosCommand(p[:i]); err == nil {
				t.Fatalf("accepted truncated %d", i)
			}
		}
		if _, err := DecodeCosCommand(append(p, 0)); err == nil {
			t.Fatal("accepted trailing byte")
		}
		p[5] = 2
		if _, err := DecodeCosCommand(p); err == nil {
			t.Fatal("accepted mode")
		}
	}
}
