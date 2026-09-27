// The spawnable-monsters subcommand prints the server's spawnable monster roster as
// JSON. It uses the same authored-position and native TypeID filters as the
// GameWorld runtime so asset builders do not need a separate classifier.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"opensro.online/server/internal/game/world/monster"
)

type monsterRosterRef struct {
	RefObjID           uint32 `json:"refObjId"`
	Codename           string `json:"codename"`
	RideModelPath      string `json:"rideModelPath,omitempty"`
	RiderTransformMode uint8  `json:"riderTransformMode,omitempty"`
}

type monsterRosterOutput struct {
	Format      string             `json:"format"`
	Source      string             `json:"source"`
	TextdataDir string             `json:"textdataDir"`
	Count       int                `json:"count"`
	Refs        []monsterRosterRef `json:"refs"`
}

func runSpawnableMonsters(args []string) error {
	dir, err := resolveEvidenceTextdataDir("spawnable-monsters", args)
	if err != nil {
		return fmt.Errorf("textdata: %w", err)
	}

	template := monster.LoadTemplate(dir)
	spawnable := template.SpawnableRefs()
	output := monsterRosterOutput{
		Format:      "sro-spawnable-monster-roster",
		Source:      "monster.LoadTemplate: npcpos.txt spawn points joined with the binary CICMonster TypeID gate ((W & 0x7FE) == 0x0C6)",
		TextdataDir: dir,
		Count:       len(spawnable),
		Refs:        make([]monsterRosterRef, 0, len(spawnable)),
	}
	for _, ref := range spawnable {
		output.Refs = append(output.Refs, monsterRosterRef{
			RefObjID:           ref.RefObjID,
			Codename:           ref.Codename,
			RideModelPath:      ref.RideModelPath,
			RiderTransformMode: ref.RiderTransformMode,
		})
	}

	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(output); err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	return nil
}
