package enterworld

import (
	"fmt"
	"strings"

	"opensro.online/server/internal/game/world/monster"
	"opensro.online/server/internal/game/world/worldarea"
)

// appendAuthoredAreaPopulation composes resource-owned population anchors into
// the ordinary immutable monster template. The live registry, visibility ring,
// lifecycle, combat and persistence paths remain exactly the normal game ones.
func appendAuthoredAreaPopulation(
	template monster.Template,
	catalog *worldarea.Catalog,
) (monster.Template, error) {
	if catalog == nil {
		return template, nil
	}
	refsByCodename := make(map[string]monster.MonsterRef, len(template.Refs))
	for _, ref := range template.Refs {
		key := strings.ToUpper(strings.TrimSpace(ref.Codename))
		if key == "" {
			continue
		}
		if previous, duplicate := refsByCodename[key]; duplicate && previous.RefObjID != ref.RefObjID {
			return monster.Template{}, fmt.Errorf(
				"authored world areas: monster codename %q maps to both %d and %d",
				ref.Codename,
				previous.RefObjID,
				ref.RefObjID,
			)
		}
		refsByCodename[key] = ref
	}

	var nests []monster.NestRow
	for _, area := range catalog.Areas() {
		for index, population := range area.Population {
			ref, ok := refsByCodename[strings.ToUpper(strings.TrimSpace(population.Codename))]
			if !ok {
				return monster.Template{}, fmt.Errorf(
					"authored world area %q population row %d references unknown monster %q",
					area.Slug,
					index,
					population.Codename,
				)
			}
			nests = append(nests, monster.NestRow{
				SpawnPoint: monster.SpawnPoint{
					RefObjID: ref.RefObjID,
					RegionID: area.RegionID,
					X:        population.X,
					Y:        population.Y,
					Z:        population.Z,
				},
				PolicyPinned:       true,
				Radius:             population.LeashRadius,
				GenerateRadius:     population.GenerateRadius,
				MaxCount:           population.MaxCount,
				RespawnDelayMinSec: population.RespawnDelayMinSec,
				RespawnDelayMaxSec: population.RespawnDelayMaxSec,
				Respawn:            population.Respawn,
				Aggressive:         population.Aggressive,
				SightRange:         population.SightRange,
			})
		}
	}
	return template.WithAdditionalNests(nests), nil
}
