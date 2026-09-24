interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Geohash MCP.
 *
 * Keyless, offline: encode a lat/lon coordinate to a geohash string and decode
 * a geohash back to its center coordinate and bounding box. Pure algorithm —
 * no API, no key.
 */


const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function encode(lat: number, lon: number, precision: number): string {
  let latR = [-90, 90], lonR = [-180, 180];
  let hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) { const mid = (lonR[0] + lonR[1]) / 2; if (lon >= mid) { ch = (ch << 1) | 1; lonR[0] = mid; } else { ch = ch << 1; lonR[1] = mid; } }
    else { const mid = (latR[0] + latR[1]) / 2; if (lat >= mid) { ch = (ch << 1) | 1; latR[0] = mid; } else { ch = ch << 1; latR[1] = mid; } }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

function decode(hash: string): { latR: number[]; lonR: number[] } | null {
  let latR = [-90, 90], lonR = [-180, 180], even = true;
  for (const c of hash.toLowerCase()) {
    const idx = B32.indexOf(c);
    if (idx < 0) return null;
    for (let mask = 16; mask >= 1; mask >>= 1) {
      if (even) { const mid = (lonR[0] + lonR[1]) / 2; if (idx & mask) lonR[0] = mid; else lonR[1] = mid; }
      else { const mid = (latR[0] + latR[1]) / 2; if (idx & mask) latR[0] = mid; else latR[1] = mid; }
      even = !even;
    }
  }
  return { latR, lonR };
}

const tools: McpToolExport['tools'] = [
  {
    name: 'encode_geohash',
    description: 'Encode a latitude/longitude to a geohash string (keyless, offline). `precision` = number of characters (1-12, default 9; more chars = smaller cell).',
    inputSchema: {
      type: 'object',
      properties: {
        lat: { type: 'number', description: 'Latitude (-90..90).' },
        lon: { type: 'number', description: 'Longitude (-180..180).' },
        precision: { type: 'number', description: 'Geohash length 1-12 (default 9).' },
      },
      required: ['lat', 'lon'],
    },
  },
  {
    name: 'decode_geohash',
    description: 'Decode a geohash to its center coordinate and bounding box (SW/NE corners). Keyless, offline.',
    inputSchema: { type: 'object', properties: { geohash: { type: 'string', description: 'A geohash, e.g. "u4pruydqqvj".' } }, required: ['geohash'] },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'encode_geohash': {
      const lat = num(args, 'lat'), lon = num(args, 'lon');
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { error: 'lat must be -90..90 and lon -180..180.' };
      const precision = Math.max(1, Math.min(12, typeof args.precision === 'number' ? args.precision : 9));
      return { lat, lon, precision, geohash: encode(lat, lon, precision) };
    }
    case 'decode_geohash': {
      const hash = reqStr(args, 'geohash', '"u4pruydqqvj"').trim();
      const r = decode(hash);
      if (!r) return { input: hash, valid: false, reason: 'Invalid geohash character.' };
      const lat = (r.latR[0] + r.latR[1]) / 2, lon = (r.lonR[0] + r.lonR[1]) / 2;
      return {
        geohash: hash, valid: true,
        center: { lat: +lat.toFixed(6), lon: +lon.toFixed(6) },
        bounding_box: { sw: { lat: r.latR[0], lon: r.lonR[0] }, ne: { lat: r.latR[1], lon: r.lonR[1] } },
        error_margin: { lat: +((r.latR[1] - r.latR[0]) / 2).toFixed(6), lon: +((r.lonR[1] - r.lonR[0]) / 2).toFixed(6) },
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function num(args: Record<string, unknown>, key: string): number {
  const v = args[key]; const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`Required numeric argument "${key}" is missing or invalid.`);
  return n;
}
function reqStr(args: Record<string, unknown>, key: string, ex: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Required argument "${key}" is missing. Pass a string like ${ex}.`);
  return v;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
