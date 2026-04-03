/**
 * Client-side types - Generic for any backend format
 */

// ==================== Base Types ====================

/** Default user data structure (can be overridden with generics) */
export interface DefaultUserData {
  id?: number | string;
  name?: string;
  email?: string;
  token_type?: string;
  type?: string;
  [key: string]: unknown;
}

// ==================== Generic Auth Types ====================

export interface AuthContextValue<TUser = DefaultUserData> {
  /** Current user data, null if not authenticated */
  user: TUser | null;
  /** Loading state for initial auth check */
  isLoading: boolean;
  /** True if user is authenticated (not guest) */
  isAuthenticated: boolean;
  /** True if user is a guest */
  isGuest: boolean;
  /** Error from last auth operation */
  error: Error | null;
  /** Login function */
  login: (credentials: LoginCredentials) => Promise<AuthResult<TUser>>;
  /** Register function */
  register: (data: RegisterData) => Promise<AuthResult<TUser>>;
  /** Logout function */
  logout: () => Promise<void>;
  /** Refresh user data */
  refresh: () => Promise<void>;
  /** SWR mutate function for manual revalidation */
  mutate: () => Promise<void>;
}

export interface AuthResult<TUser = DefaultUserData> {
  success: boolean;
  message?: string;
  user?: TUser;
  errors?: Record<string, unknown>;
}

export interface AuthProviderProps<TUser = DefaultUserData> {
  children: React.ReactNode;
  /** Initial user data from server (SSR) */
  initialUser?: TUser | null;
  /** Endpoint to fetch user data */
  userEndpoint?: string;
  /** Endpoint for login */
  loginEndpoint?: string;
  /** Endpoint for register */
  registerEndpoint?: string;
  /** Endpoint for logout */
  logoutEndpoint?: string;
  /** Redirect to this path after logout (uses window.location.href) */
  logoutRedirect?: string;
  /** 
   * Function to check if user is a guest
   * @default (user) => user?.token_type === 'guest' || user?.type === 'guest'
   */
  isGuestFn?: (user: TUser | null) => boolean;
  /**
   * Function to parse API response and extract user data
   * @default (response) => response.data || response.user || response
   */
  parseResponse?: (response: unknown) => TUser | null;
  /** SWR config overrides */
  swrConfig?: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
    revalidateOnReconnect?: boolean;
  };
  /** Called when user logs in */
  onLogin?: (user: TUser) => void;
  /** Called when user logs out */
  onLogout?: () => void;
  /** Called on auth error */
  onError?: (error: Error) => void;
}

// ==================== Non-Generic Types ====================

export interface LoginCredentials {
  email?: string;
  username?: string;
  password: string;
  remember?: boolean;
  [key: string]: unknown; // Allow custom fields
}

export interface RegisterData {
  name?: string;
  email?: string;
  password?: string;
  password_confirmation?: string;
  [key: string]: unknown; // Allow custom fields
}

export interface UseAuthOptions {
  /** Redirect to this path if not authenticated */
  redirectTo?: string;
  /** Redirect to this path if authenticated */
  redirectIfFound?: string;
}

// ==================== API Response Types ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Record<string, unknown>;
}

// ==================== Legacy Exports (backwards compatibility) ====================

/** @deprecated Use DefaultUserData or your own type */
export type UserData = DefaultUserData;
