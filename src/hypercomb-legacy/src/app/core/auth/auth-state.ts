export interface Autstate {
  isAuthenticated: boolean
  username: string
  userId: string
  email?: string
  roles?: string[]
  accessToken?: string
  idToken?: string
  identifier?: string
  accessLevel?: string
}



