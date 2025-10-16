import { Injectable } from "@angular/core"

@Injectable({ providedIn: 'root'})
export class ImageSourceParser {
    
    public parse(input: string): string[] {
      if (!input) {
        console.error('Input string is empty or undefined.')
        return []
      }
  
      // Regular expression to match <img> tags and extract the src attribute
      const imgSrcRegex = /<img[^>]*\s+src=["']([^"']+)["']/gi
  
      const sources: string[] = []
      let match
  
      // Iterate over all matches and extract the src values
      while ((match = imgSrcRegex.exec(input)) !== null) {
        sources.push(match[1]) // Add the captured src value to the array
      }
  
      return sources
    }
  }
  

