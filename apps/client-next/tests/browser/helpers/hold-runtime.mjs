import {CLIENT_NEXT_BASE_URL} from '../../../../../scripts/lib/probeEndpoints.mjs';

// Keep the loaded runtime alive for a long behavioral probe in a shared
// workspace. Omit this page's development update clients so an unrelated edit
// cannot cover captured game pixels. Application transports remain live.
export async function holdProbeRuntime(page){
 // WebSocket routing injects Playwright bridge evaluations, which can grant
 // Chromium activation and invalidate an autoplay test. HTML routing does not.
 const target=new URL(CLIENT_NEXT_BASE_URL);
 await page.route(url=>url.origin===target.origin&&url.pathname===target.pathname,async route=>{
  const response=await route.fetch(),html=await response.text();
  await route.fulfill({response,body:html.replace(/<script\b[^>]*\bsrc=["']\/@vite\/client["'][^>]*>\s*<\/script>/g,'').replace(/<script\b[^>]*>\s*import \{installDevUpdates\}[^<]*<\/script>/g,'')});
 });
}

// Exercise the retained opt-in implementation without changing the workspace default.
export async function enableNativeCharacterLighting(page){
 await page.route('**/src/engine/foundation/rendering/video-options.ts*',async route=>{
  const response=await route.fetch(),source=await response.text(),marker='const NATIVE_CHARACTER_LIGHTING = false;';
  if(!source.includes(marker))throw Error('Missing character lighting build switch');
  await route.fulfill({response,body:source.replace(marker,'const NATIVE_CHARACTER_LIGHTING = true;')});
 });
}
