#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
. /usr/lib/qmanager/euicc.sh
# =============================================================================
# profile.sh — CGI Endpoint: local eUICC profile state changes (POST)
# =============================================================================
# Body: {"action":"enable|disable|delete","iccid":"<human digits>","iccid_hex":"<20 hex>"}
#
# <iccid_hex> is the EF_ICCID value from GetProfilesInfo, not the human ICCID.
# The frontend already parses it; passing it back avoids a second BCD encoder
# here. <iccid> is used only for the active-profile delete guard.
#
# Enable/disable trigger a UICC REFRESH, so the response may arrive just before
# the modem drops off the network. The frontend re-reads status after the modem
# returns; the result code alone is not proof that the switch happened.
#
# Endpoint: POST /cgi-bin/quecmanager/euicc/profile.sh
# Install location: /www/cgi-bin/quecmanager/euicc/profile.sh
# =============================================================================

qlog_init "cgi_euicc_profile"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_method_not_allowed
fi

cgi_read_post

action=$(printf '%s' "$POST_DATA" | jq -r '.action // empty' 2>/dev/null)
iccid=$(printf '%s' "$POST_DATA" | jq -r '.iccid // empty' 2>/dev/null)
iccid_hex=$(printf '%s' "$POST_DATA" | jq -r '.iccid_hex // empty' 2>/dev/null | tr 'a-f' 'A-F')

case "$action" in
    enable|disable|delete) ;;
    *)
        cgi_error "invalid_action" "action must be enable, disable or delete"
        exit 0
        ;;
esac

case "$iccid" in
    ""|*[!0-9F]*)
        cgi_error "invalid_iccid" "iccid must contain digits or F padding only"
        exit 0
        ;;
esac
case "${#iccid}" in
    19|20) ;;
    *)
        cgi_error "invalid_iccid" "iccid must be 19 or 20 digits"
        exit 0
        ;;
esac

case "$iccid_hex" in
    ""|*[!0-9A-F]*)
        cgi_error "invalid_iccid_hex" "iccid_hex must be 20 hex characters"
        exit 0
        ;;
esac
if [ "${#iccid_hex}" -ne 20 ]; then
    cgi_error "invalid_iccid_hex" "iccid_hex must be 20 hex characters"
    exit 0
fi

# Deleting the active profile is irreversible and immediately removes service.
# Enable/disable are allowed because switching is the point; delete is not.
if [ "$action" = "delete" ]; then
    active_iccid=$(qcmd 'AT+QCCID?' 2>/dev/null \
        | sed -n 's/.*+QCCID: *\([0-9][0-9]*\).*/\1/p' \
        | head -n 1)
    if [ -n "$active_iccid" ] && [ "$iccid" = "$active_iccid" ]; then
        cgi_error "active_profile" "Refusing to delete the active profile"
        exit 0
    fi
fi

_euicc_cleanup() {
    euicc_close
}
trap _euicc_cleanup EXIT INT TERM

if ! euicc_open; then
    qlog_warn "eUICC profile: could not open ISD-R"
    cgi_error "euicc_unavailable" "Could not open the eUICC ISD-R channel"
    exit 0
fi

apdu=$(euicc_profile_apdu "$action" "$iccid_hex") || {
    cgi_error "apdu_build_failed" "Could not build the eUICC APDU"
    exit 0
}

qlog_info "eUICC profile: action=$action iccid=$iccid"
result_hex=$(euicc_apdu "$apdu")

euicc_close

if [ -z "$result_hex" ]; then
    qlog_warn "eUICC profile: no APDU response for $action $iccid"
    cgi_error "euicc_write_failed" "The eUICC did not answer the profile command"
    exit 0
fi

# EnableProfileResponse / DisableProfileResponse / DeleteProfileResponse:
# <BF tag> 03 80 01 <result> 9000. result=0 is ok; 1 is not found.
result=$(printf '%s' "$result_hex" \
    | sed -n 's/.*8001\([0-9A-Fa-f]\{2\}\).*/\1/p' \
    | head -n 1)

refresh_expected=false
if [ "$action" != "delete" ]; then
    refresh_expected=true
fi

jq -n \
    --arg action "$action" \
    --arg iccid "$iccid" \
    --arg result "$result" \
    --arg result_hex "$result_hex" \
    --argjson refresh_expected "$refresh_expected" \
    '{
        success: true,
        action: $action,
        iccid: $iccid,
        result: $result,
        result_hex: $result_hex,
        refresh_expected: $refresh_expected
    }'
