$c = Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"
  "listener PID:     $($proc.ProcessId)"
  "started:          $($proc.CreationDate)"
  "command line:     $($proc.CommandLine)"
  "parent PID:       $($proc.ParentProcessId)"
  $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)" -ErrorAction SilentlyContinue
  "parent:           $($parent.Name) ($($parent.CommandLine))"
} else {
  'nothing listening on 7777'
}
"service status:   $((Get-Service hypercomb-relay).Status)"
"service params:   $(nssm get hypercomb-relay AppParameters)"
