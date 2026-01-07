import { Injectable } from "@angular/core"

@Injectable({
    providedIn: 'root'
})
export class ValidationService { 
    valid(func: Function, ...parameters: any){ 
        return func.apply(this,parameters)
    }
}

