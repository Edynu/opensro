package enterworld

// nativeAgentErrorTextKeyByCode ports the native agent-error text table.
var nativeAgentErrorTextKeyByCode = map[int]string{
	0x02: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x03: "UIO_SMERR_INVALID_CHARGEN_INFO",
	0x04: "UIO_MSG_ERROR_CHARACTER_SELECTWEAPON",
	0x05: "UIO_MSG_ERROR_CHARACTER_OVER_3",
	0x06: "UIO_SMERR_FAILED_TO_CREATE_CHARACTER",
	0x07: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x08: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x09: "UIO_SMERR_CANT_FIND_GAMESERVER",
	0x0a: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x0b: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x0c: "UIO_MSG_ERROR_CHARACTER_NAME_STRING",
	0x0d: "UIO_SMERR_NOT_ALLOWED_CHARNAME",
	0x0e: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x0f: "UIO_SMERR_CANT_ACCESS_PARENT_SERVER",
	0x10: "UIO_MSG_ERROR_ID",
	0x11: "UIO_MSG_ERROR_OVERLAP",
	0x12: "UIO_SMERR_FAILED_TO_CREATE_NEW_USER",
	0x13: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x14: "UIO_SMERR_MAX_USER_EXCEEDED",
	0x15: "UIO_SMERR_FAILED_TO_ENTERLOBBY",
	0x16: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x17: "UIO_MSG_ERROR_SEVER_CONNECT",
	0x18: "UIO_MSG_ERROR_SEVER_CONNECT",
}

// nativeAgentErrorDirectCodes names codes the client presents without an
// "(S<code>)" status suffix.
var nativeAgentErrorDirectCodes = map[int]bool{
	0x04: true,
	0x05: true,
	0x0c: true,
	0x0d: true,
	0x10: true,
	0x11: true,
	0x14: true,
}

// NativeAgentError is the browser-facing description of one native error.
type NativeAgentError struct {
	NativeErrorCode  int    `json:"nativeErrorCode"`
	OK               bool   `json:"ok"`
	TextKey          string `json:"textKey"`
	Presentation     string `json:"presentation"`
	StatusTextSuffix string `json:"statusTextSuffix,omitempty"`
}

// DescribeNativeAgentError resolves the native code's presentation policy.
func DescribeNativeAgentError(nativeErrorCode int) NativeAgentError {
	errorCode := nativeErrorCode & 0xff
	if errorCode == nativeResultSuccess {
		return NativeAgentError{
			NativeErrorCode: errorCode,
			OK:              true,
			TextKey:         "",
			Presentation:    "none",
		}
	}
	textKey, ok := nativeAgentErrorTextKeyByCode[errorCode]
	if !ok {
		textKey = "UIO_MSG_ERROR_SEVER_CONNECT"
	}
	if nativeAgentErrorDirectCodes[errorCode] {
		return NativeAgentError{
			NativeErrorCode: errorCode,
			OK:              false,
			TextKey:         textKey,
			Presentation:    "direct",
		}
	}
	suffix := "(S" + itoa(errorCode) + ")"
	return NativeAgentError{
		NativeErrorCode:  errorCode,
		OK:               false,
		TextKey:          textKey,
		Presentation:     "subcode",
		StatusTextSuffix: suffix,
	}
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	digits := []byte{}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
