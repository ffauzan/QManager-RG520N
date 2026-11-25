#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# download.sh — CGI Endpoint: start an eUICC profile download (POST)
# =============================================================================
# Body: {"activation_code":"LPA:1$sm-dp+$matching-id","confirmation_code":""}
#
# lpac runs in the background because an SM-DP+ download can take longer than a
# CGI request. The frontend polls /euicc/download_status.sh for the outcome.
#
# Endpoint: POST /cgi-bin/quecmanager/euicc/download.sh
# Install location: /www/cgi-bin/quecmanager/euicc/download.sh
# =============================================================================

qlog_init "cgi_euicc_download"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "POST" ]; then
    cgi_method_not_allowed
fi

cgi_read_post

CODE=$(printf '%s' "$POST_DATA" | jq -r '.activation_code // empty' 2>/dev/null)
CONFIRM=$(printf '%s' "$POST_DATA" | jq -r '.confirmation_code // empty' 2>/dev/null)

case "$CODE" in
    LPA:1\$*\$*) ;;
    *)
        cgi_error "invalid_activation_code" "Use the full LPA:1\$server\$matching-id code"
        exit 0
        ;;
esac

# The code is passed to a shell script, so reject anything that is not part of
# an SM-DP+ hostname or matching ID. This also blocks quotes and command
# separators before they reach the background process.
case "$CODE" in
    *[!A-Za-z0-9._:@/+\$\=-]*)
        cgi_error "invalid_activation_code" "Activation code contains unsupported characters"
        exit 0
        ;;
esac

case "$CONFIRM" in
    *[!A-Za-z0-9._-]*)
        cgi_error "invalid_confirmation_code" "Confirmation code contains unsupported characters"
        exit 0
        ;;
esac

STATUS="/tmp/qmanager_euicc_download.json"
PID_FILE="/tmp/qmanager_euicc_download.pid"

if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if pid_alive "$OLD_PID"; then
        cgi_error "already_running" "A profile download is already in progress"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

if ! command -v /usr/bin/qmanager_lpac >/dev/null 2>&1; then
    cgi_error "lpac_missing" "The LPA helper is not installed"
    exit 0
fi

rm -f "$STATUS" /tmp/qmanager_euicc_download.log
jq -n '{state:"running",message:"Starting profile download",detail:"",iccid:"",profile_name:""}' > "$STATUS"

# Detach from the CGI request; the helper writes its own PID and status file.
sh /usr/bin/qmanager_euicc_download "$CODE" "$CONFIRM" >/dev/null 2>&1 &

jq -n '{success:true,state:"running"}'
