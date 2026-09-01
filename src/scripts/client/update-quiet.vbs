' Run the updater with no window at all.
'
' Task Scheduler shows a console for anything it starts under the Interactive
' logon type, and S4U - which would not - needs a privilege this machine did
' not grant. wscript with window style 0 is the one way that always works, and
' it costs nothing: the updater already writes update.log beside the exe, so
' suppressing the window loses no information.
Set shell = CreateObject("WScript.Shell")
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.Run "node """ & here & "windows-client.mjs""", 0, False
