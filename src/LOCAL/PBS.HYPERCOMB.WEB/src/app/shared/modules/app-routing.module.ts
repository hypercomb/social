import { NgModule } from "@angular/core"
import { Routes, RouterModule } from "@angular/router"
import { CallbackComponent } from "../../core/auth/callback-component"
import { EmptyComponent } from "../../common/shared/empty-component"
import { TileEditorComponent } from "../../common/tile-editor/tile-editor.component"
import { ShellComponent } from "src/app/common/shell/shell.component"

// { matcher: customUrlMatcher,    component: ShellComponent },
const routes: Routes = [
  { path: "unauthorized", component: TileEditorComponent },
  { path: "silent-renew.html", component: EmptyComponent },
  { path: "callback", component: CallbackComponent },

  // 🔑 catch-all: always load ShellComponent
  { path: "**", component: ShellComponent }
]

@NgModule({
  imports: [RouterModule.forRoot(routes, { bindToComponentInputs: true }),],
  exports: [RouterModule]
})
export class AppRoutingModule { }


