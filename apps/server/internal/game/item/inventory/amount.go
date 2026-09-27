package inventory

// ItemAmount is a version-independent authored grant or consumption request.
// The item authority resolves its codename against this world's item catalog.
type ItemAmount struct {
	Codename string
	Count    uint32
}
