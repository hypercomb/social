import { Injectable, inject } from "@angular/core"
import { LocatorService } from "src/app/unsorted/utility/locator-service"

@Injectable({ providedIn: 'root' })
export class NamingService {
  private readonly locator = inject(LocatorService)

  public generatePageKey = (configSource: string): string => {
    const { usercode, sharecode } = this.locator.parseCodes(configSource)
    const sanitize = (code: string) => code.replace(/-/g, '').substring(0, 12)

    return `${sanitize(usercode)}-${sanitize(sharecode ?? '')}`
  }

  public createValidName = (input: string): string => {
    if (!input) return ''

    // decode URI components before sanitizing
    const decoded = decodeURIComponent(input)

    return decoded
      .replace(/[^a-zA-Z0-9#]/g, '-')  // replace non-alphanumeric except #
      .replace(/-+/g, '-')             // collapse multiple hyphens
      .replace(/^[-]+|[-]+$/g, '')     // trim leading/trailing hyphens
      .toLowerCase()                   // normalize to lowercase
  }
}


