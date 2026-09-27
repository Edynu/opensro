// Thin facade: the former monolith was split verbatim into per-domain modules
// (2026-07-28). This file re-exports the public surface so the root facades
// (scripts/build/{cif,text,title,launcher,fonts,config,audio}.mjs) stay untouched.
export { buildCifResources } from "./cifResources.mjs";
export { buildTextResources } from "./textResources.mjs";
export { buildTitleResources, deriveTitleAreaFromIntroName } from "./titleResources.mjs";
export { buildLauncherResources, copyLauncherAssets } from "./launcherResources.mjs";
export { buildFontResources } from "./fontResources.mjs";
export { buildConfigResources } from "./configResources.mjs";
export { buildAudioResources } from "./audioResources.mjs";
