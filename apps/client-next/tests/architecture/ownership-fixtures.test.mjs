import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyOwnership } from "../../tools/verify-ownership.mjs";

const bootstrap = "src/bootstrap.ts", root = "src/engine/runtime/root.ts";
const child = "src/engine/runtime/child.ts", contract = "src/engine/runtime/private/types.ts";
function fixture(change, check) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-fixture-"));
    const manifest = { version: 1, bootstrap, root, modules: { [root]: bootstrap, [child]: root }, internals: {}, workers: {}, contracts: {} };
    const files = { [bootstrap]: 'import "./engine/runtime/root";', [root]: 'import "./child";', [child]: 'export type Child = string;' };
    try {
        change(manifest, files);
        for (const [file, source] of Object.entries(files)) {
            const target = path.join(base, file);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, source);
        }
        fs.writeFileSync(path.join(base, "src/engine/ownership.json"), JSON.stringify(manifest));
        check(verifyOwnership(base));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
test("minimal ownership tree passes", () => fixture(() => {}, issues => assert.deepEqual(issues, [])));
const cases = [
    ["extra root", (m, f) => { m.modules[child] = bootstrap; f[bootstrap] += 'import "./engine/runtime/child";'; f[root] = ''; }, /Extra ownership root/],
    ["orphan internal", m => { delete m.modules[child]; m.internals[child] = bootstrap; }, /Undeclared internals owner/],
    ["orphan contract", m => { delete m.modules[child]; m.contracts[child] = bootstrap; }, /Undeclared contracts owner/],
    ["missing internal", m => { m.internals['src/missing.ts'] = root; }, /Invalid internals endpoint/],
    ["worker owner mismatch", m => { m.workers[child] = bootstrap; }, /Worker ownership mismatch/],
    ["overlapping classification", m => { m.internals[child] = root; }, /Conflicting ownership/],
    ["ownership cycle", m => { m.modules[root] = child; }, /Ownership cycle/],
    ["invalid version", m => { m.version = 2; }, /Invalid ownership root/],
    ["missing modules", m => { delete m.modules; }, /Invalid ownership manifest/],
    ["null contracts", m => { m.contracts = null; }, /Invalid ownership manifest/],
    ["array modules", m => { m.modules = []; }, /Invalid ownership manifest/],
    ["non-string owner", m => { m.modules[child] = {}; }, /Invalid modules endpoint/],
    ["missing bootstrap", m => { m.bootstrap = 'src/missing.ts'; }, /Invalid ownership manifest/],
    ["syntax error", (m, f) => { f[child] = 'export const = ;'; }, /src\/engine\/runtime\/child.ts:/],
    ["inline type import is not a runtime edge", (m, f) => { f[root] = 'import { type Child } from "./child";'; }, /Missing owner-to-child edge/],
    ["inline type export is not a runtime edge", (m, f) => { f[root] = 'export { type Child } from "./child";'; }, /Missing owner-to-child edge/],
    ["type import is not a runtime edge", (m, f) => { f[root] = 'import type { Child } from "./child";'; }, /Missing owner-to-child edge/],
    ["runtime import of worker", m => { m.workers[child] = root; }, /forbidden import/],
    ["undeclared worker", (m, f) => { f[root] = 'new Worker(new URL("./child.ts", import.meta.url));'; }, /undeclared worker/],
    ["computed import", (m, f) => { f[child] += 'import(target);'; }, /computed dynamic import/],
    ["worker URL with external base", (m, f) => { m.workers[child] = root; f[root] = 'new Worker(new URL("./child.ts", "https://example.com/"));'; }, /worker URL must be statically declared/],
    ["worker URL without base", (m, f) => { m.workers[child] = root; f[root] = 'new Worker(new URL("./child.ts"));'; }, /worker URL must be statically declared/],
];
for (const [name, change, pattern] of cases)
    test(`reject ${name}`, () => fixture(change, issues => assert.match(issues.join('\n'), pattern)));

for (const syntax of ['import type { Value }', 'import { type Value }'])
    test(`private contract accepts ${syntax}`, () => fixture((m, f) => {
        m.contracts[contract] = root;
        f[contract] = 'export type Value = string;';
        f[root] += `${syntax} from "./private/types";`;
    }, issues => assert.deepEqual(issues, [])));

test("contract rejects side-effect dependencies", () => fixture((m, f) => {
    m.contracts[contract] = root;
    f[contract] = 'import "../../contracts/shared"; export type Value = string;';
    f['src/engine/contracts/shared.ts'] = 'export const VALUE = 1;';
}, issues => assert.match(issues.join('\n'), /type-only dependencies/)));

test("declared worker spawn passes", () => fixture((m, f) => {
    m.workers[child] = root;
    f[root] = 'new Worker(new URL("./child.ts", import.meta.url));';
}, issues => assert.deepEqual(issues, [])));

test("mixed import remains a runtime edge", () => fixture((m, f) => {
    f[root] = 'import { type Child, value } from "./child";';
    f[child] += 'export const value = 1;';
}, issues => assert.deepEqual(issues, [])));

test("JavaScript extension resolves to TypeScript source", () => fixture((m, f) => {
    f[root] = 'import "./child.js";';
}, issues => assert.deepEqual(issues, [])));

test("shared signed scalar constants pass", () => fixture((m, f) => {
    f['src/engine/foundation/constants.ts'] = 'export const LOW = -1; export const HIGH = +1; export const MASK = 1n;';
}, issues => assert.deepEqual(issues, [])));

for (const [extension, specifier] of [['mts', './child.mjs'], ['cts', './child.cjs'], ['tsx', './child']])
    test(`resolves ${extension} source`, () => fixture((m, f) => {
        const target = child.replace(/\.ts$/, `.${extension}`);
        m.modules[target] = root;
        delete m.modules[child];
        f[target] = f[child];
        delete f[child];
        f[root] = `import "${specifier}";`;
    }, issues => assert.deepEqual(issues, [])));

test("private internals can import each other", () => fixture((m, f) => {
    const helper = 'src/engine/runtime/helper.ts';
    delete m.modules[child];
    m.internals[child] = root;
    m.internals[helper] = root;
    f[helper] = 'export const value = 1;';
    f[child] = 'import "./helper";';
}, issues => assert.deepEqual(issues, [])));

test("bootstrap cannot reach a private contract", () => fixture((m, f) => {
    m.contracts[contract] = root;
    f[contract] = 'export type Value = string;';
    f[bootstrap] += 'import type { Value } from "./engine/runtime/private/types";';
}, issues => assert.match(issues.join('\n'), /forbidden import/)));

test("optional contracts map may be omitted", () => fixture(m => {
    delete m.contracts;
}, issues => assert.deepEqual(issues, [])));

test("alias resolves owner-to-child runtime imports", () => fixture((m, f) => {
    f[root] = 'import "@/engine/runtime/child";';
}, issues => assert.deepEqual(issues, [])));

test("alias resolves private contract types", () => fixture((m, f) => {
    m.contracts[contract] = root;
    f[contract] = 'export type Value = string;';
    f[root] += 'import type { Value } from "@/engine/runtime/private/types";';
}, issues => assert.deepEqual(issues, [])));

test("alias cannot bypass ownership", () => fixture((m, f) => {
    f[bootstrap] += 'import "@/engine/runtime/child";';
}, issues => assert.match(issues.join('\n'), /forbidden import/)));

test("unknown alias does not resolve", () => fixture((m, f) => {
    f[root] = 'import "@other/engine/runtime/child";';
}, issues => assert.match(issues.join('\n'), /unresolved or external dependency/)));
