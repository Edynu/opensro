import { test } from "node:test";
import assert from "node:assert/strict";
import { launchProbeBrowser } from "../../../../scripts/lib/probeBrowser.mjs";
test("replacement foundation runs its worker and GPU without legacy modules", { timeout: 30000 }, async () => {
    const { browser, page } = await launchProbeBrowser();
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => requests.push(request.url()));
    try {
        await page.goto("http://127.0.0.1:5180/");
        await page.waitForFunction(() => document.querySelector("output")?.textContent?.includes("runtime: running"));
        const first = await page.locator("output").textContent();
        await page.waitForFunction(before => document.querySelector("output")?.textContent !== before, first);
        // Title controls cover the canvas; exercise unfocused keyboard input directly.
        await page.keyboard.press("w");
        await page.waitForFunction(() => /Input acknowledged: [1-9]/.test(document.querySelector("output")?.textContent ?? ""));
        await page.setViewportSize({ width: 960, height: 540 });
        await page.waitForFunction(() => document.querySelector("canvas")?.width > 0);
        assert.deepEqual(errors, []);
        assert.ok(requests.some(url => url.includes("worker/entry.ts")));
        assert.ok(!requests.some(url => /babylon|wip-bridge|browser-1to1|apps\/client\//.test(url)));
    }
    finally {
        await browser.close();
    }
});
