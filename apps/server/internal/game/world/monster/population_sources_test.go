package monster

// Source evidence indexes remain available to the provenance tests, but are
// not additional process-lifetime copies in the production server.
var v1188PopulationEvidence = mustLoadPopulationEvidence(populationEvidenceTSV)
var populationEvidenceRows = combinePopulationEvidence(v1188PopulationEvidence, mustLoadPopulationEvidence(populationSupplementTSV))
var populationTacticsControls = loadTacticsControls(tacticsControlsJSON)
var hiveCaps = loadHiveCaps(hiveCapsTSV)
