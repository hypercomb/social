// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EmptyComponent } from 'src/app/common/shared/empty-component';
import { ShellComponent } from 'src/app/common/shell/shell.component';
import { CallbackComponent } from 'src/app/core/auth/callback-component';


const routes: Routes = [
  // auth callbacks
  { path: 'silent-renew.html', component: EmptyComponent },
  { path: 'callback', component: CallbackComponent },

  // id-based hive loading
  // /12345, /88219, /@vanity → handled by shell
  {
    path: ':id',
    component: ShellComponent
  },

  // community fallback (no id)
  {
    path: '',
    pathMatch: 'full',
    component: ShellComponent
  },

  // final fallback
  { path: '**', component: ShellComponent }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { bindToComponentInputs: true })],
  exports: [RouterModule]
})
export class AppRoutingModule {

}
