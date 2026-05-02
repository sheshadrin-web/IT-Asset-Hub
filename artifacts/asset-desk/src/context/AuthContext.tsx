import { createContext, useContext, useState, ReactNode } from "react";
import { User, UserRole, mockUsers } from "@/data/mockData";

interface AuthContextType {
  currentUser: User | null;
  login: (role: UserRole) => void;
  loginByEmail: (email: string) => boolean;
  logout: () => void;
  isAuthenticated: boolean;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const login = (role: UserRole) => {
    const user = mockUsers.find((u) => u.role === role);
    if (user) setCurrentUser(user);
  };

  const loginByEmail = (email: string): boolean => {
    const user = mockUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (user) {
      setCurrentUser(user);
      return true;
    }
    return false;
  };

  const logout = () => setCurrentUser(null);

  const hasRole = (...roles: UserRole[]): boolean => {
    if (!currentUser) return false;
    return roles.includes(currentUser.role);
  };

  return (
    <AuthContext.Provider
      value={{ currentUser, login, loginByEmail, logout, isAuthenticated: currentUser !== null, hasRole }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
