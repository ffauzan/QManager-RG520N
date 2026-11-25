#!/bin/sh
. /usr/lib/qmanager/cgi_base.sh
# =============================================================================
# speedtest_servers.sh — CGI Endpoint: List Nearby Speedtest Servers
# =============================================================================
# Runs `speedtest --servers -f json`, extracts the server list, and returns it.
#
# Endpoint: GET /cgi-bin/quecmanager/at_cmd/speedtest_servers.sh
# Install location: /www/cgi-bin/quecmanager/at_cmd/speedtest_servers.sh
# =============================================================================

qlog_init "cgi_speedtest_servers"
cgi_headers
cgi_handle_options

if [ "$REQUEST_METHOD" != "GET" ]; then
    cgi_error "method_not_allowed" "Use GET"
    exit 0
fi

if ! command -v speedtest >/dev/null 2>&1; then
    cgi_error "not_installed" "speedtest-cli is not installed"
    exit 0
fi

# Set environment the Ookla binary needs (without sourcing /etc/profile)
export HOME="${HOME:-/root}"
export USER="${USER:-root}"
export LOGNAME="${LOGNAME:-root}"
export TMPDIR="${TMPDIR:-/tmp}"
export LANG="${LANG:-C}"
export LC_ALL="${LC_ALL:-C}"
export TERM="${TERM:-xterm}"
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

# Run server list to temp file. Measured live on an RM520N-GL: ~1.2s, cold or
# warm (the earlier "2-5 seconds" estimate here was pessimistic). Note this
# forks the Ookla binary SYNCHRONOUSLY inside the request, so the UI's refresh
# affordance costs a real process spawn on a single-core device each time.
OUTFILE="/tmp/qmanager_speedtest_servers.json"
speedtest --servers --accept-license --accept-gdpr -f json > "$OUTFILE" 2>/dev/null

if [ ! -s "$OUTFILE" ]; then
 rm -f "$OUTFILE"
 # Distinguish "no internet" from a genuine Ookla failure: with no default
 # route the binary cannot reach the API, and reporting list_failed sends users
 # hunting the wrong problem (docs/10 C9).
 if ! ip route 2>/dev/null | grep -q '^default '; then
 cgi_error "no_internet" "No internet connection — connect first, then refresh the server list"
 exit 0
 fi
 cgi_error "list_failed" "Failed to fetch server list"
 exit 0
fi

# Extract .servers array from {"type":"serverList","servers":[...]}
SERVERS=$(jq -c '.servers' "$OUTFILE" 2>/dev/null)
rm -f "$OUTFILE"

if [ -z "$SERVERS" ] || [ "$SERVERS" = "null" ]; then
    cgi_error "list_failed" "No servers found in response"
    exit 0
fi

printf '{"success":true,"servers":%s}' "$SERVERS"
