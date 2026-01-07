
export interface ILinkResolver {
    resolve(link: string)
    canResolve(link: string): boolean
}

export interface IGoogleLink {
    link: string
    identifier: string
    params: string
    type: string
}

export interface INavigationCommand {
    navigate()   // Action to perform when navigating to a route
    goBack()    // Action to perform when navigating away (back action)
}

export interface IYouTubeLink {
    link: string
    videoId: string
}



