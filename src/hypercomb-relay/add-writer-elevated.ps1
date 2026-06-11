# Runs elevated (launched via UAC). Adds the publisher browser's pubkey to
# the relay's --writers list (keeping the existing writer), then does the
# CLEAN restart from fix-relay-elevated.ps1 — kill the wrapper tree, free
# port 7777, start fresh — so the new parameters actually take effect
# (a bare `nssm restart` leaves an orphan listener and the new instance
# dies EADDRINUSE, which is what happened at 18:02 UTC).
$log = 'C:\Projects\hypercomb\social\src\hypercomb-relay\add-writer-result.txt'
Start-Transcript -Path $log -Force | Out-Null

$relayJs    = 'C:\Projects\hypercomb\social\src\hypercomb-relay\relay.js'
$contentDir = 'C:\Projects\hypercomb\social\src\hypercomb-relay\content'
$writers    = '3b94560cc3066e84ea952904f79ab81846822e7f8ffc95a732458b8d396ec7ae,fd2f10ba0f6046fba70bcb248724a08eb49e0c9515caf8ba7df9758433cf8cee'

nssm set hypercomb-relay AppParameters "$relayJs --port 7777 --content-dir $contentDir --writers $writers"
"params set to: $(nssm get hypercomb-relay AppParameters)"

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
Start-Sleep -Seconds 2
"service state after: $((Get-Service hypercomb-relay).Status)"

$now = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($now) {
  $p = Get-Process -Id $now.OwningProcess
  "port 7777 now held by PID $($p.Id) ($($p.ProcessName)) started $($p.StartTime)"
} else {
  "WARNING: nothing listening on 7777"
}
Stop-Transcript | Out-Null
