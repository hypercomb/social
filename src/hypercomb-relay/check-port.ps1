$c = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) {
  $p = Get-Process -Id $c.OwningProcess
  "PID $($p.Id) $($p.ProcessName) started $($p.StartTime)"
} else {
  'nothing listening on 7777'
}
"service: $((Get-Service hypercomb-relay).Status)"
"params:  $(nssm get hypercomb-relay AppParameters)"
