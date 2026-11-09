# Runs elevated (launched via UAC). Adds --restart-when-stale to the
# hypercomb-relay service's launch line (once), then restarts the service so
# the node process runs the relay.js on disk. From then on the relay leaves on
# its own when its code changes and the service wrapper starts the new code
# (code-stamp.js). Writes everything to restart-result.txt for the
# non-elevated session to read.
$log = 'C:\Projects\hypercomb\social\src\hypercomb-relay\restart-result.txt'
Start-Transcript -Path $log -Force | Out-Null

$flag = '--restart-when-stale'
$params = ((& nssm get hypercomb-relay AppParameters) -join '' -replace "`0", '').Trim()
if (-not $params) {
  "ERROR: could not read the service's AppParameters - nothing changed"
} elseif ($params -match [regex]::Escape($flag)) {
  "launch line already carries $flag"
} else {
  & nssm set hypercomb-relay AppParameters "$params $flag" | Out-Null
  "launch line now ends with $flag"
}

$svc = Get-CimInstance Win32_Service -Filter "Name='hypercomb-relay'"
"service state before: $($svc.State)  wrapper PID: $($svc.ProcessId)"
Restart-Service hypercomb-relay
Start-Sleep -Seconds 3
"service state after: $((Get-Service hypercomb-relay).Status)"

$now = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($now) {
  $p = Get-Process -Id $now.OwningProcess
  "port 7777 now held by PID $($p.Id) ($($p.ProcessName)) started $($p.StartTime)"
} else {
  "WARNING: nothing listening on 7777"
}

Stop-Transcript | Out-Null
