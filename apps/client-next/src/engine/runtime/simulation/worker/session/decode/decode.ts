import type { CharacterRecord, ServerRecord } from "@/engine/contracts/session";
export function createSessionDecoder() {
    function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected response object"); return value as Record<string, unknown>; }
    function string(value: unknown): string { if (typeof value !== "string" || !value || value.length > 4096)
        throw new Error("Invalid response string"); return value; }
    function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new Error("Invalid response number"); return value; }
    function integer(value: unknown): number { const result = number(value); if (!Number.isSafeInteger(result))
        throw new Error("Invalid response integer"); return result; }
    function boolean(value: unknown): boolean { if (typeof value !== "boolean")
        throw new Error("Invalid response boolean"); return value; }
    function array(value: unknown, limit = 256): unknown[] { if (!Array.isArray(value) || value.length > limit)
        throw new Error("Invalid response array"); return value; }
    function strings(value: unknown): readonly string[] { return Object.freeze(array(value).map(string)); }
    function character(value: unknown): CharacterRecord {
        const v = object(value), loadout = object(v.visualLoadout);
        const deletionBlocker=v.deletionBlocker;
        if(deletionBlocker!==undefined&&(typeof deletionBlocker!=='string'||!['guild-master','guild-member','academy-guardian','academy-student'].includes(deletionBlocker)))throw Error('Invalid deletion blocker');
        const numeric: Record<string, number> = {};
        for (const key of ["id", "level", "raceIndex", "gender", "figureIndex", "heightIndex", "volumeIndex", "weaponIndex", "protectorIndex", "maxHp", "maxMp"])
            numeric[key] = integer(v[key]);
        for (const key of ["bodyShapeByte", "experiencePercent", "skillPoints", "currentHp", "currentMp"])
            if (v[key] !== undefined)
                numeric[key] = number(v[key]);
        let filters: Record<string, readonly string[]> | undefined;
        if (loadout.dressPartFilters !== undefined) {
            filters = Object.create(null) as Record<string, readonly string[]>;
            const entries = Object.entries(object(loadout.dressPartFilters));
            if (entries.length > 256)
                throw new Error("Too many outfit filters");
            for (const [key, parts] of entries)
                filters[string(key)] = strings(parts);
            Object.freeze(filters);
        }
        const height = number(loadout.heightScale), volume = number(loadout.volumeScale);
        if (height === 0 || volume === 0)
            throw new Error("Invalid character scale");
        return Object.freeze({ ...numeric, ...(deletionBlocker!==undefined?{deletionBlocker}:{}), name: string(v.name), armorSelected: boolean(v.armorSelected), weaponSelected: boolean(v.weaponSelected), deletePending: boolean(v.deletePending), ...(v.deleteReservedAt !== undefined ? { deleteReservedAt: string(v.deleteReservedAt) } : {}), visualLoadout: Object.freeze({ modelCodename: string(loadout.modelCodename), animationSetName: string(loadout.animationSetName), dressSetKeys: strings(loadout.dressSetKeys), weaponSetKeys: strings(loadout.weaponSetKeys), ...(filters ? { dressPartFilters: filters } : {}), heightScale: height, volumeScale: volume }) }) as unknown as CharacterRecord;
    }
    return {
        servers(value: unknown): readonly ServerRecord[] {
            const ids = new Set<string>();
            return Object.freeze(array(value, 4096).map(item => { const v = object(item), id = string(v.id); if (ids.has(id))
                throw new Error("Duplicate server identity"); ids.add(id); return Object.freeze({ id, name: string(v.name), onlinePlayers: integer(v.onlinePlayers), capacity: integer(v.capacity), nativeServerId: integer(v.nativeServerId), nativeFarmId: integer(v.nativeFarmId), isTest: boolean(v.isTest), operating: boolean(v.operating), transportUrl: string(v.transportUrl) }); }));
        },
        roster(value: unknown): readonly CharacterRecord[] {
            const v = object(value);
            if (v.characterRosterContractVersion !== 1 || v.action !== 2 || v.nativeResult !== 1)
                throw new Error("Unsupported character roster response");
            const ids = new Set<number>();
            return Object.freeze(array(v.characters).map(row => { const result = character(row); if (ids.has(result.id))
                throw new Error("Duplicate character identity"); ids.add(result.id); return result; }));
        }
    };
}
