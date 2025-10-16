export interface IOpenAiQuery { 
    query(prompt:string) : Promise<any>
    canQuery(query:string)
} 


