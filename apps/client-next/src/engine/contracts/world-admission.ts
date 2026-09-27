import type {WorldScene} from './scene';

/** Worker-only publication, after full render admission. Structured transfer
 * isolates its arrays/metadata before a host lease can be constructed. */
export interface PreparedWorldScene {
    readonly scene: WorldScene;
    readonly bytes: number;
    readonly starBytes: number;
}

/** One-use move capability. No scene/array reference is exposed before takeWorld().
 * Consumption transfers ownership even when the receiving renderer rejects it. */
export interface WorldSceneLease {
    readonly sceneId: string;
    takeWorld(): PreparedWorldScene;
}
