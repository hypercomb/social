import { NgModule } from "@angular/core";
import { AuthModule } from "angular-auth-oidc-client";
import { environment } from "src/environments/environment";

@NgModule({
  imports: [AuthModule.forRoot({
    config: {
      authority: 'https://accounts.hypercomb.io/realms/portal',
      redirectUrl: `${window.location.origin}/callback`,
      postLogoutRedirectUri: window.location.origin,
      clientId: environment.production ? 'development' : 'hypercomb-platform',
      scope: 'openid profile hypercomb_claims email offline_access',
      responseType: 'code',
      silentRenew: true,
      silentRenewUrl: window.location.origin + '/silent-renew.html',
      useRefreshToken: true,
      renewTimeBeforeTokenExpiresInSeconds: 30
    },
  })],

  exports: [AuthModule]
})
export class AuthConfigModule { }


