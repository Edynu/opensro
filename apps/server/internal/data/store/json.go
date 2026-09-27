package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// decodeJSONStrict is the canonical-record decoder. Persisted live records
// are owned by this binary, so unknown fields or trailing documents mean
// schema drift or hand-editing. Accepting either would silently discard data
// on the next commit.
func decodeJSONStrict(raw []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("trailing JSON document")
		}
		return fmt.Errorf("trailing JSON: %w", err)
	}
	return nil
}
