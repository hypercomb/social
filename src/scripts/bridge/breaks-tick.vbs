' scripts/bridge/breaks-tick.vbs
'
' Runs ONE break repair tick with no console window. This is what the scheduled
' task calls (install-breaks-tick.ps1): a console flashing up every few minutes
' is the one cost a tick must not have. It waits for the tick, so Task
' Scheduler's IgnoreNew keeps a tick that is still waiting on a review from
' being stacked on. The log goes to %TEMP%\hypercomb-breaks-tick.log unless
' BREAKS_LOG is already set.
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("Process")
If env("BREAKS_LOG") = "" Then env("BREAKS_LOG") = shell.ExpandEnvironmentStrings("%TEMP%") & "\hypercomb-breaks-tick.log"
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here & "\..\.."
shell.Run "node """ & here & "\breaks.cjs"" tick", 0, True
