#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# download_status.sh — CGI Endpoint: profile download progress (GET)
# =============================================================================
# Reads the JSON status file written by qmanager_euicc_download.
#
# Endpoint: GET /cgi-bin/quecmanager/euicc/download_status.sh
# Install location: /www/cgi-bin/quecmanager/euicc/download_status.sh
# =============================================================================

qlog_init "cgi_euicc_download_status"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_method_not_allowed
fi

STATUS="/tmp/qmanager_euicc_download.json"
if [ ! -f "$STATUS" ]; then
    jq -n '{state:"idle"}'
    exit 0
fi

cat "$STATUS"
