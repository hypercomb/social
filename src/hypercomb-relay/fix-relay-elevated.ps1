# Runs elevated (launched via UAC). Kills the wedged hypercomb-relay
# wrapper tree, frees port 7777, starts the service fresh, and writes
# everything it did to fix-result.txt for the non-elevated session to read.
$log = 'C:\Projects\hypercomb\social\src\hypercomb-relay\fix-result.txt'
Start-Transcript -Path $log -Force | Out-Null

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
