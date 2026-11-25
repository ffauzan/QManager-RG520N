#!/bin/sh
# eUICC ES10c helpers — ISD-R channel management and STORE DATA APDUs.
#
# QManager's AT lane is serialized by qmanager_atd. These helpers keep the
# ISD-R logical channel open only for the duration of one CGI request and
# always close it again; a leaked channel is a finite resource.
#
# The eUICC APDU path is deliberately narrow: read EID/profiles/info and the
# three local state changes (enable, disable, delete). Profile download needs a
# full LPA (ES9+ / SM-DP+ / BPP) and is not implemented here.

[ -n "$_EUICC_LIB_LOADED" ] && return 0
_EUICC_LIB_LOADED=1

EUICC_AID="A0000005591010FFFFFFFF8900000100"
EUICC_CH=""
EUICC_OPENED=0

# euicc_open — open the ISD-R application on a logical channel.
# Sets EUICC_CH from +CCHO: <ch>. Returns 1 when the channel did not open.
euicc_open() {
    _euicc_raw=$(qcmd "AT+CCHO=\"$EUICC_AID\"" 2>/dev/null) || return 1
    EUICC_CH=$(printf '%s' "$_euicc_raw" \
        | sed -n 's/.*+CCHO: *\([0-9][0-9]*\).*/\1/p' \
        | head -n 1)
    [ -n "$EUICC_CH" ] || return 1
    EUICC_OPENED=1
    return 0
}

# euicc_close — close the channel if one is open. Safe to call repeatedly.
euicc_close() {
    [ "$EUICC_OPENED" = "1" ] || return 0
    qcmd "AT+CCHC=$EUICC_CH" >/dev/null 2>&1 || true
    EUICC_OPENED=0
    EUICC_CH=""
    return 0
}

# euicc_apdu <apdu_hex> — send one APDU through AT+CGLA.
# Prints the response data hex (without +CGLA wrapper). Returns 1 when the
# modem rejected the command or returned no +CGLA line.
#
# <apdu_hex> is a complete APDU including CLA/INS/P1/P2/Lc/data/Le. The length
# argument to AT+CGLA counts HEX CHARACTERS, not bytes — ${#_hex} is correct.
euicc_apdu() {
    _euicc_apdu_hex=$1
    [ "$EUICC_OPENED" = "1" ] || return 1
    _euicc_raw=$(qcmd "AT+CGLA=$EUICC_CH,${#_euicc_apdu_hex},\"$_euicc_apdu_hex\"" 2>/dev/null) || return 1
    printf '%s' "$_euicc_raw" \
        | sed -n 's/.*+CGLA: *[0-9][0-9]*,"\([0-9A-Fa-f]*\)".*/\1/p' \
        | head -n 1
}

# euicc_profile_apdu <action> <iccid_hex> — build the STORE DATA APDU for one
# local profile operation.
#
# SGP.22 uses AUTOMATIC TAGS. profileIdentifier is a CHOICE inside a SEQUENCE,
# so enable/disable require an explicit A0 wrapper. DeleteProfile is a bare
# CHOICE and must not carry one.
#
# <iccid_hex> is the 10-byte EF_ICCID value exactly as GetProfilesInfo returns
# it (nibble-swapped). Callers must validate it before reaching this function.
euicc_profile_apdu() {
    _euicc_action=$1
    _euicc_iccid=$2

    case "$_euicc_action" in
        enable)
            _euicc_tlv="BF3111A00C5A0A${_euicc_iccid}8101FF"
            ;;
        disable)
            _euicc_tlv="BF3211A00C5A0A${_euicc_iccid}8101FF"
            ;;
        delete)
            _euicc_tlv="BF330C5A0A${_euicc_iccid}"
            ;;
        *)
            return 1
            ;;
    esac

    _euicc_lc=$(printf '%02X' $(( ${#_euicc_tlv} / 2 )))
    printf '81E29100%s%s00' "$_euicc_lc" "$_euicc_tlv"
}
