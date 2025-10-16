
export class HypercombValidations { 
    public static url(url:string) : boolean {     
      // filter out images because they are urls, too
      if(HypercombValidations.image(url)) return false

        try {
            new URL(url)
          } catch (e) {
            console.error(e)
            return false
          }
          return true
    }
    public static image(source:string) : boolean { 
      return(source.match(/\.(jpeg|jpg|gif|png|webp)$/gi) != null)
    }
}

