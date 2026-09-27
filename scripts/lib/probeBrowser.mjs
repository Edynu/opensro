// Chrome launcher for browser tests and probes (playwright-core).

import { chromium } from "playwright-core";

/**
 * Launch the standard probe browser: system Chrome, isolated profile, the
 * headless GPU flags every existing harness uses. `headed` is for local
 * debugging (e.g. PROFILE_HEADED=1).
 *
 * SRO_PROBE_EXTRA_CHROME_ARGS appends ad-hoc space-separated Chrome switches
 * (e.g. "--enable-unsafe-webgpu" for the ?webgpu=1 runs; pair it with
 * SRO_PROBE_EXTRA_QUERY="&webgpu=1").
 *
 * @param {{
 *   headed?: boolean,
 *   viewport?: { width: number, height: number },
 *   deviceScaleFactor?: number,
 *   extraBrowserArgs?: string[],
 *   executablePath?: string,
 *   userDataDir?: string
 * }} [options]
 */
export async function launchProbeBrowser({
  headed = false,
  viewport = { width: 1600, height: 900 },
  deviceScaleFactor,
  extraBrowserArgs = [],
  executablePath,
  userDataDir
} = {}) {
  const extraArgs = (process.env.SRO_PROBE_EXTRA_CHROME_ARGS ?? "")
    .split(/\s+/)
    .filter((arg) => arg.length > 0);
  const unlockArgs =
    process.env.SRO_PROBE_UNLOCK_FPS === "1"
      ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"]
      : [];
  const launchOptions = {
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    headless: !headed,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-angle=default",
      ...unlockArgs,
      ...extraArgs,
      ...extraBrowserArgs
    ]
  };
  const pageOptions = {
    viewport,
    ...(deviceScaleFactor === undefined ? {} : { deviceScaleFactor })
  };
  if (userDataDir) {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      ...pageOptions
    });
    const browser = context.browser();
    if (!browser) {
      await context.close();
      throw new Error("persistent probe context did not expose its browser");
    }
    const page = context.pages()[0] ?? (await context.newPage());
    return { browser, page };
  }

  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({
    ...pageOptions
  });
  return { browser, page };
}
