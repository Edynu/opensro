package domain

// ActiveQuestRecord is one persisted in-progress quest. Optional fields are
// emitted by the quest wire layer according to Flags, so zero values remain
// meaningful when their flag is present.
type ActiveQuestRecord struct {
	// Stage belongs to the server quest owner. It is persisted but never added
	// to the versioned SQuestInfo wire grammar. Legacy records begin at zero.
	Stage uint16 `json:"stage,omitempty"`
	// RemainingMinutes is native quest-user +4, decremented by the online
	// character's minute pulse. Zero with a timed definition means expired.
	RemainingMinutes uint8  `json:"remainingMinutes,omitempty"`
	RefID            uint32 `json:"refId"`
	U08              uint8  `json:"u08"`
	U09              uint8  `json:"u09"`
	Flags            uint8  `json:"flags"`

	Progress uint32 `json:"progress,omitempty"`
	U10      uint8  `json:"u10,omitempty"`

	Contents  []ActiveQuestContentsNode `json:"contents,omitempty"`
	TargetIds []uint32                  `json:"targetIds,omitempty"`
}

// ActiveQuestContentsNode is one tagged quest-content node. A sentinel count
// is distinct from an empty objective list on the native wire.
type ActiveQuestContentsNode struct {
	// CompletionReached is the server mission latch (native quest-user +3).
	// It survives collection loss/reacquisition and is never added to SQuestInfo.
	CompletionReached bool   `json:"completionReached,omitempty"`
	Tag               uint8  `json:"tag"`
	Kind              uint8  `json:"kind"`
	Description       string `json:"description"`

	ObjectiveSentinel bool     `json:"objectiveSentinel,omitempty"`
	ObjectiveValues   []uint32 `json:"objectiveValues,omitempty"`
}

// TrackedQuestRecord is one persisted tracker row. Tail6 is normalized to six
// bytes by the quest wire encoder, and Optional is emitted when Flags bit 1 is
// set.
type TrackedQuestRecord struct {
	RefID  uint32 `json:"refId"`
	Flags  uint8  `json:"flags"`
	ValueA uint8  `json:"valueA"`
	Word   uint16 `json:"word"`

	Tail6    []uint8 `json:"tail6"`
	Optional uint32  `json:"optional,omitempty"`
}
