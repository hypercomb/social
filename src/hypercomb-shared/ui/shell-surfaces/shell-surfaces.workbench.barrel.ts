// The workbench door. A try- door loads this list and nothing else from the
// shell: the chat, on the package that door serves. The command line is a
// mode inside that chat. The visitor portal uses the website barrel.

import '../chat-window/chat-window.component'

// The door mounts no command line, so nothing there heard a machine's
// sentence. This hears it without one: behaviour words only, through core's
// admission gate (../command-line/remote-door.headless.ts).
import { installHeadlessRemoteDoor } from '../command-line/remote-door.headless'

installHeadlessRemoteDoor()
