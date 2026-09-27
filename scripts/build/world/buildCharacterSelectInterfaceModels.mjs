import path from "node:path";
import { CHARACTER_SELECT_INTERFACE_MODELS } from "./constants.mjs";
import { writeJson } from "./io.mjs";
import { extractedRoot, gameRoot, publicRoot } from "./paths.mjs";
import { buildTitleSectorObjectResources } from "./objects/buildTitleSectorObjectResources.mjs";

// CPSCharacterSelect::OnCreate loads box.bsr + the 3 race idols as CInterfaceModel
// instances placed at fixed region-local positions/yaws (see constants.mjs). They
// are NOT SWorld stream objects, so they get their own resource bundle + manifest
// that the client renders as always-visible foreground props. The BSR/BMS/BMT
// parsing reuses the exact static-object pipeline (buildTitleSectorObjectResources).
const INTERFACE_MODEL_AREA = "character-select";

export async function buildCharacterSelectInterfaceModels() {
  const props = CHARACTER_SELECT_INTERFACE_MODELS.map((model, index) => ({
    ...model,
    objectId: index + 1
  }));

  const objectDefinitions = props.map((prop) => ({
    objectId: prop.objectId,
    flags: 0,
    sourcePath: prop.bsrPath
  }));

  // One synthetic placement per prop so buildTitleSectorObjectResources records a
  // placementCount of 1 for each BSR (the value is informational only).
  const placements = props.map((prop) => ({ objectId: prop.objectId }));

  const resources = await buildTitleSectorObjectResources({
    area: INTERFACE_MODEL_AREA,
    extractedRoot,
    gameRoot,
    objectDefinitions,
    placements
  });

  const manifest = {
    format: "sro-cps-interface-models",
    version: 1,
    sourcePath: "SRO_Client.exe:sub_73bf00 (CPSCharacterSelect::OnCreate, sub_73c930)",
    props: props.map((prop) => ({
      name: prop.name,
      objectId: prop.objectId,
      bsrPath: prop.bsrPath,
      position: { x: prop.position.x, y: prop.position.y, z: prop.position.z },
      yaw: prop.yaw,
      scale: prop.scale
    })),
    resources
  };

  const manifestPublicPath = "/assets/character-select/interface-models.json";
  const manifestPath = path.join(publicRoot, "assets", "character-select", "interface-models.json");
  await writeJson(manifestPath, manifest);

  return {
    manifestPublicPath,
    propCount: manifest.props.length,
    bsrCount: resources.bsrCount,
    meshCount: resources.meshCount,
    materialSetCount: resources.materialSetCount,
    textureCount: resources.textureCount,
    missing: resources.missing
  };
}
