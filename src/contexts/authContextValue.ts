import { createContext } from 'react';

export interface AuthUser {
  username: string;
  role: string;
}

export interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  login: (tokenValue: string, userData: AuthUser) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
