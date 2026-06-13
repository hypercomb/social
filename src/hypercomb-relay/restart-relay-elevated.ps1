# Runs elevated (launched via UAC). Gracefully restarts the
# hypercomb-relay service so the node process reloads relay.js from
# disk (rate-limit fix: 100 -> 1200 msgs/min was edited after the
# running process started). Writes everything to restart-result.txt
# for the non-elevated session to read.
$log = 'C:\Projects\hypercomb\social\src\hypercomb-relay\restart-result.txt'
Start-Transcript -Path $log -Force | Out-Null

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
