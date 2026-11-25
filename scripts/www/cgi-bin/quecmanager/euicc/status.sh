#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/euicc.sh
# =============================================================================
# status.sh — CGI Endpoint: eUICC identity and installed profiles (GET)
# =============================================================================
# Opens ISD-R, reads EID + GetProfilesInfo + GetEUICCInfo2, closes the channel.
# The profile list is returned as raw ES10c TLV hex; the frontend parses it.
# Keeping BER-TLV parsing out of shell avoids a fragile second parser for a
# payload that can carry a 1 KiB profile icon.
#
# Endpoint: GET /cgi-bin/quecmanager/euicc/status.sh
# Install location: /www/cgi-bin/quecmanager/euicc/status.sh
# =============================================================================

qlog_init "cgi_euicc_status"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
fi

_euicc_cleanup() {
    euicc_close
}
trap _euicc_cleanup EXIT INT TERM

if ! euicc_open; then
    qlog_warn "eUICC status: could not open ISD-R"
    cgi_error "euicc_unavailable" "Could not open the eUICC ISD-R channel"
    exit 0
fi

eid_resp=$(euicc_apdu "81E2910006BF3E035C015A00")
profiles_raw=$(euicc_apdu "81E2910003BF2D0000")
info2_raw=$(euicc_apdu "81E2910003BF220000")

euicc_close

if [ -z "$profiles_raw" ]; then
    qlog_warn "eUICC status: GetProfilesInfo returned no data"
    cgi_error "euicc_read_failed" "The eUICC did not return a profile list"
    exit 0
fi

# BF3E 12 5A 10 <16-byte EID> 9000 — take the 32 hex digits after 5A10.
eid=$(printf '%s' "$eid_resp" \
    | sed -n 's/.*5A10\([0-9A-Fa-f]\{32\}\).*/\1/p' \
    | head -n 1)

qlog_info "eUICC status: eid=${eid:-unknown} profiles_bytes=$(( ${#profiles_raw} / 2 ))"

jq -n \
    --arg eid "$eid" \
    --arg profiles_raw "$profiles_raw" \
    --arg info2_raw "$info2_raw" \
    '{
        success: true,
        eid: $eid,
        profiles_raw: $profiles_raw,
        info2_raw: $info2_raw
    }'
