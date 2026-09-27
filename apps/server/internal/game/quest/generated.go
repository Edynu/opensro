package quest

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed catalog_generated.json
var generatedCatalog []byte

// This is a build-time projection of the version evidence, not runtime Lua or
// a dependency on research files. Every entry still passes the normal loader.
func catalogSpecs(catalog *Catalog) ([]QuestSpec, error) {
	specs := append([]QuestSpec(nil), curatedQuestSpecs...)
	var generated []QuestSpec
	decoder := json.NewDecoder(bytes.NewReader(generatedCatalog))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&generated); err != nil {
		return nil, fmt.Errorf("generated quest catalog: %w", err)
	}
	for _, spec := range append(append([]QuestSpec(nil), europeanTutorialSpecs...), generated...) {
		// The small protocol-test catalogs intentionally contain only their own
		// rows. Production loads the complete verified v1.150 media catalog.
		if _, ok := catalog.QuestByCodename(spec.Codename); ok {
			specs = append(specs, spec)
		}
	}
	return specs, nil
}
