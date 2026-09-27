package store

import (
	"strings"
	"testing"

	"opensro.online/server/internal/domain"
)

func TestCanonicalRecordDecoderRefusesDrift(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name string
		raw  string
		want string
	}{
		{"unknown field", `{"id":1,"masterCharId":1,"retiredField":true}`, "unknown field"},
		{"trailing document", `{"id":1,"masterCharId":1}{"id":2,"masterCharId":2}`, "trailing JSON document"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var record domain.TrainingCampRecord
			err := decodeJSONStrict([]byte(test.raw), &record)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("decode error = %v, want %q", err, test.want)
			}
		})
	}
}
