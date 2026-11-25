// Run: bun run scripts-dev/check-euicc-parser.ts
//
// Minimal GetProfilesInfo payload with the A0 wrapper the RG520N-EB eUICC
// returns around each E3 ProfileInfo. Exercises nibble-swapped ICCID decoding,
// profile state, and the end of the TLV list.

import assert from "node:assert/strict";

import { parseEuiccProfiles } from "../lib/euicc";

const payload =
  "BF2D2CA02AE3285A0A982690046200109711649F7001019109536D6172746672656E9209536D6172746672656E950102";

const profiles = parseEuiccProfiles(payload);

assert.equal(profiles.length, 1);
assert.equal(profiles[0]?.iccid, "89620940260001791146");
assert.equal(profiles[0]?.iccidHex, "98269004620010971164");
assert.equal(profiles[0]?.name, "Smartfren");
assert.equal(profiles[0]?.spn, "Smartfren");
assert.equal(profiles[0]?.state, "enabled");

console.log("eUICC profile parser: ok");
