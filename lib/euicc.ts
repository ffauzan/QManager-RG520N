// ES10c profile-list decoding.
//
// The CGI returns the raw GetProfilesInfo TLV instead of a shell-parsed list.
// A profile entry can carry a 1 KiB icon, and BER-TLV with long-form lengths
// is exactly the kind of parsing JavaScript does without a second language.
// This module is the one decoder; the backend never guesses at fields.

export type EuiccProfileState = "enabled" | "disabled" | "unknown";

export interface EuiccProfile {
  /** Human ICCID as printed on the SIM, e.g. 89620940260001791146. */
  iccid: string;
  /** The EF_ICCID value exactly as the eUICC returned it (10 bytes, hex). */
  iccidHex: string;
  name: string;
  spn: string;
  state: EuiccProfileState;
  profileClass?: number;
  aid?: string;
}

interface Tlv {
  tag: number;
  value: Uint8Array;
  /** Offset immediately after this TLV in the buffer it was read from. */
  next: number;
}

function readTlv(buf: Uint8Array, offset: number): Tlv | null {
  if (offset < 0 || offset + 2 > buf.length) return null;

  let cursor = offset;
  let tag = buf[cursor++];

  if ((tag & 0x1f) === 0x1f) {
    if (cursor >= buf.length) return null;
    tag = (tag << 8) | buf[cursor++];
  }

  let length = buf[cursor++];
  if (length === undefined) return null;

  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || cursor + count > buf.length) return null;
    length = 0;
    for (let i = 0; i < count; i += 1) {
      length = length * 256 + buf[cursor++];
    }
  }

  if (cursor + length > buf.length) return null;

  return {
    tag,
    value: buf.subarray(cursor, cursor + length),
    next: cursor + length,
  };
}

function readChildren(value: Uint8Array): Tlv[] {
  const children: Tlv[] = [];
  let offset = 0;

  while (offset < value.length) {
    const tlv = readTlv(value, offset);
    if (!tlv) break;
    children.push(tlv);
    offset = tlv.next;
  }

  return children;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function decodeText(value: Uint8Array | undefined): string {
  if (!value || value.length === 0) return "";
  try {
    return new TextDecoder().decode(value).trim();
  } catch {
    return "";
  }
}

/**
 * EF_ICCID stores each pair of decimal digits nibble-swapped. 0x98 is "89",
 * not "98". F is the 4-bit padding value; keep it visible rather than silently
 * shortening an identifier the user may need to compare.
 */
function decodeIccid(value: Uint8Array): string {
  let out = "";
  for (const byte of value) {
    out += (byte & 0x0f).toString(16).toUpperCase();
    out += (byte >> 4).toString(16).toUpperCase();
  }
  return out;
}

/**
 * Parse the GetProfilesInfo response (BF2D) into profiles.
 * Returns [] for an empty list or an unrecognised payload.
 */
export function parseEuiccProfiles(rawHex: string): EuiccProfile[] {
  if (!rawHex) return [];

  const root = readTlv(hexToBytes(rawHex), 0);
  if (!root || root.tag !== 0xbf2d) return [];

  // Observed on RG520N-EB: the list wraps each E3 ProfileInfo in an A0
  // container. Walk one level of A0 wrappers rather than assuming a direct
  // SEQUENCE OF ProfileInfo.
  const entries: Tlv[] = [];
  const collect = (parent: Tlv) => {
    for (const child of readChildren(parent.value)) {
      if (child.tag === 0xe3) {
        entries.push(child);
      } else if (child.tag === 0xa0) {
        collect(child);
      }
    }
  };
  collect(root);

  const profiles: EuiccProfile[] = [];

  for (const entry of entries) {
    const fields = new Map<number, Tlv>();
    for (const field of readChildren(entry.value)) {
      fields.set(field.tag, field);
    }

    const iccidValue = fields.get(0x5a)?.value;
    const iccidHex = iccidValue ? bytesToHex(iccidValue) : "";
    const iccid = iccidValue ? decodeIccid(iccidValue) : "";
    const stateValue = fields.get(0x9f70)?.value;
    const state: EuiccProfileState =
      stateValue?.length === 1
        ? stateValue[0] === 1
          ? "enabled"
          : stateValue[0] === 0
            ? "disabled"
            : "unknown"
        : "unknown";

    const spn = decodeText(fields.get(0x91)?.value);
    const name =
      decodeText(fields.get(0x92)?.value) ||
      decodeText(fields.get(0x90)?.value) ||
      spn ||
      iccid;

    profiles.push({
      iccid,
      iccidHex,
      name,
      spn,
      state,
      profileClass: fields.get(0x95)?.value[0],
      aid: fields.get(0x4f)?.value
        ? bytesToHex(fields.get(0x4f)!.value)
        : undefined,
    });
  }

  return profiles;
}
