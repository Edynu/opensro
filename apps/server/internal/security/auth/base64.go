package auth

import (
	"encoding/base64"
	"errors"
)

var errNonCanonicalBase64URL = errors.New("auth: non-canonical base64url")

// decodeCanonicalBase64URL refuses alternate textual encodings of the same
// bytes. Bearer tokens are identifiers as well as signatures; accepting
// nonzero unused padding bits makes one token have several spellings.
func decodeCanonicalBase64URL(value string) ([]byte, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, err
	}
	if base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, errNonCanonicalBase64URL
	}
	return decoded, nil
}
