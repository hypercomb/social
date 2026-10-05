# Runs elevated (launched via UAC). The meeting point hosts the meeting:
# appends --allow-participants to the relay service's parameters (keeping
# everything already there — the writers list included), then does the CLEAN
# restart from add-writer-elevated.ps1: kill the wrapper tree, free port 7777,
# start fresh. A bare `nssm restart` leaves an orphan listener and the new
# instance dies EADDRINUSE.
#
# Run only after relay.js in this checkout knows the flag (documentation/
# swarm-host.md): an older relay ignores it and keeps participants closed.
$log = 'C:\Projects\hypercomb\social\src\hypercomb-relay\allow-participants-result.txt'
Start-Transcript -Path $log -Force | Out-Null

$relayJs = 'C:\Projects\hypercomb\social\src\hypercomb-relay\relay.js'
if (-not (Select-String -Path $relayJs -Pattern '--allow-participants' -SimpleMatch -Quiet)) {
  "STOP: $relayJs does not know --allow-participants yet. Merge the swarm-host change first."
  Stop-Transcript | Out-Null
  exit 1
}

$params = (nssm get hypercomb-relay AppParameters) -join ' '
"params before: $params"
if ($params -notmatch '--allow-participants') {
  nssm set hypercomb-relay AppParameters "$params --allow-participants"
}
"params after:  $(nssm get hypercomb-relay AppParameters)"

$svc = Get-CimInstance Win32_Service -Filter "Name='hypercomb-relay'"
"service state before: $($svc.State)  wrapper PID: $($svc.ProcessId)"
if ($svc.ProcessId -and $svc.ProcessId -ne 0) {
  taskkill /F /T /PID $svc.ProcessId
}
Start-Sleep -Seconds 1

$listeners = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $listeners) {
  "killing leftover listener PID $($c.OwningProcess)"
  taskkill /F /PID $c.OwningProcess
}
Start-Sleep -Seconds 1

net start hypercomb-relay
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
