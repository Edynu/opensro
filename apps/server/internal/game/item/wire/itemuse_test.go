package wire

import (
	"errors"
	"reflect"
	"testing"
)

func TestItemUseWire(t *testing.T) {
	request, err := DecodeItemUseRequest([]byte{0x14, 0xEC, 0x08})
	if err != nil {
		t.Fatalf("DecodeItemUseRequest: %v", err)
	}
	if request.Slot != 0x14 || request.TypeWord != 0x08EC {
		t.Fatalf("request = %+v, want slot 0x14 type 0x08EC", request)
	}

	if got, want := EncodeItemUseSuccess(0x14, 49, 0x08EC),
		[]byte{0x01, 0x14, 0x31, 0x00, 0xEC, 0x08}; !reflect.DeepEqual(got, want) {
		t.Fatalf("success = % X, want % X", got, want)
	}
	if got, want := EncodeItemUseError(0x02), []byte{0x02, 0x02}; !reflect.DeepEqual(got, want) {
		t.Fatalf("error = % X, want % X", got, want)
	}
}

func TestItemUseRequestRejectsWrongLengths(t *testing.T) {
	for _, payload := range [][]byte{
		{0x14, 0xEC},
		{0x14, 0xEC, 0x08, 0x00},
	} {
		_, err := DecodeItemUseRequest(payload)
		if err == nil {
			t.Fatalf("DecodeItemUseRequest(% X) accepted", payload)
		}
		if len(payload) > 3 && !errors.Is(err, ErrTrailingBytes) {
			t.Fatalf("overlong error = %v, want ErrTrailingBytes", err)
		}
	}
}
