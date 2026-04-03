/**
 * Server module exports
 * For use in Server Components and API routes
 */

export { 
  getServerUser, 
  isAuthenticatedServer, 
  getServerToken 
} from './getServerUser';

export type { 
  GetServerUserOptions, 
  ServerUserResult 
} from './getServerUser';
