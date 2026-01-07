import { Component, OnInit } from "@angular/core";
import { OidcSecurityService } from "angular-auth-oidc-client";

@Component({
  standalone: true,
  selector: 'app-callback', // SUSPECT NOT USED
  template: `<p>Redirecting...</p>`
})
export class CallbackComponent implements OnInit {
  constructor(private oidcSecurityService: OidcSecurityService) { }

  ngOnInit() {
    // This triggers the library to complete the login process
    this.oidcSecurityService.checkAuth().subscribe()
  }
}


