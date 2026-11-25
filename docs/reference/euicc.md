# eUICC / eSIM profile management

QManager reads and manages the installed eUICC profiles from **Cellular → eSIM
Profiles** (`/cellular/euicc`).

## Read path

`GET /cgi-bin/quecmanager/euicc/status.sh` opens ISD-R
(`A0000005591010FFFFFFFF8900000100`), reads:

- `GetEID`
- `GetProfilesInfo`
- `GetEUICCInfo2`

and closes the logical channel with `AT+CCHC`. The profile list is returned as
raw `BF2D` TLV; `lib/euicc.ts` parses it in the browser. On RG520N-EB each `E3`
ProfileInfo is wrapped in an `A0` container.

## Local state changes

`POST /cgi-bin/quecmanager/euicc/profile.sh` wraps ES10c `EnableProfile`,
`DisableProfile` and `DeleteProfile` in `AT+CGLA` through the `qcmd` broker.
The frontend re-reads `GetProfilesInfo` after every write and verifies the
target state; an ES10c result code alone is not treated as proof. Deleting the
active profile is refused by the backend.

## Add profile (SM-DP+ download)

`POST /cgi-bin/quecmanager/euicc/download.sh` starts a background job;
`GET /cgi-bin/quecmanager/euicc/download_status.sh` reports its state.

The job runs `qmanager_lpac profile download -a <activation code>`. A downloaded
profile is installed **disabled**; the user enables it from the profile list.

`qmanager_lpac` is lpac v2.2.1 built for ARMv7. The local patch adds
`AT_USE_QCMD=1`, which makes lpac send AT commands through `qcmd` instead of
opening `/dev/smd11` directly. This preserves `qmanager_atd`'s serialization and
avoids fighting the poller for the AT lane.

Rebuild the binary with:

```sh
sh scripts-dev/build-lpac-arm.sh
```

The source patch is `scripts-dev/lpac-qcmd-at.patch`. lpac is AGPL-3.0; keep its
license/source offer with any redistribution.

## Limits

- Download requires an active internet connection (the current profile or
  another WAN path).
- SM-DP+ TLS verification follows lpac's `LPAC_HTTP_SSL_VERIFY` (default off).
  Set it explicitly if the modem has a CA bundle and the server certificate is
  trusted.
- Notification processing is not automated yet; lpac leaves the install
  notification on the eUICC.
