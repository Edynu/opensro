// SRO_Client 91B830: characterInfo final flag byte bit 0 -> record+39.
/** @param {string} text */
export function parseWeatherEvents(text) {
  const rows = new Map(); let active = false;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const cells = line.split('\t');
    if (cells[0] === '#section') { active = cells[1] === 'characterInfo'; continue; }
    if (!active || !cells[0] || cells[0].startsWith('//')) continue;
    const flags = Number(cells[11]?.split(',')[0]);
    if (!Number.isInteger(flags)) throw new Error('Invalid characterInfo weather flags: ' + cells[0]);
    rows.set(cells[0], (flags & 1) !== 0);
  }
  return rows;
}
