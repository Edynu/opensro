import { readFile } from "node:fs/promises";
import { decodeJmxText } from "../../shared/jmxBinaryReader.mjs";

/** Read native dungeoninfo rows, treating a missing optional source as an empty table. */
export async function readDungeonInfoRows(filePath) {
  let text;
  try {
    // Paths are CP949 byte strings in this retail table, decoded like every other
    // JMX name so they match the extracted tree (ASCII rows are unchanged).
    text = decodeJmxText(await readFile(filePath));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const match = /^(\d+)\s+"([^"]+)"/.exec(trimmed);
    if (!match) continue;
    rows.push({
      regionId: Number.parseInt(match[1], 10),
      dofName: match[2]
    });
  }
  return rows;
}
