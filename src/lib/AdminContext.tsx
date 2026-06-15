import React, { createContext, useContext, useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { doc, onSnapshot, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';

import { SiteConfig, UserConfig } from '../types';

enum OperationType {
  GET = 'get',
  WRITE = 'write'
}

const SUPER_ADMIN_EMAIL = 'yohu.vn@gmail.com';

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error Detailed: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUB_ACCOUNT = 'SUB_ACCOUNT',
  UNAUTHORIZED = 'UNAUTHORIZED'
}

interface AdminContextType {
  isAuthenticated: boolean;
  setIsAuthenticated: (v: boolean) => void;
  isEditMode: boolean;
  setIsEditMode: (v: boolean) => void;
  customData: Record<string, any>;
  updateCustomData: (key: string, value: any) => void;
  user: any;
  role: UserRole;
  userConfig: UserConfig | null;
  isLoading: boolean;
  pendingStatus: string | null;
  loginWithPassword: (email: string, pass: string) => Promise<boolean>;
  logoutUser: () => Promise<void>;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export const AdminProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<UserRole>(UserRole.UNAUTHORIZED);
  const [userConfig, setUserConfig] = useState<UserConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [customData, setCustomData] = useState<Record<string, any>>({});
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  useEffect(() => {
    // Check if there is a saved custom session
    const savedSession = sessionStorage.getItem("yohu_custom_admin_user") || localStorage.getItem("yohu_custom_admin_user");
    
    if (savedSession) {
      try {
        const customUser = JSON.parse(savedSession);
        setUser(customUser);
        setIsAuthenticated(true);
        if (customUser.email === SUPER_ADMIN_EMAIL) {
          setRole(UserRole.SUPER_ADMIN);
          setPendingStatus(null);
          setIsLoading(false);
        } else {
          // Fetch sub-account details to refresh role
          getDoc(doc(db, 'authorized_emails', customUser.email)).then((subAccountDoc) => {
            if (subAccountDoc.exists()) {
              const data = subAccountDoc.data();
              if (data.isActive !== false) {
                setRole(UserRole.SUB_ACCOUNT);
                setPendingStatus(null);
                setUserConfig({
                  imagekitPrivateKey: data.imagekitPrivateKey || '',
                  imagekitPublicKey: data.imagekitPublicKey || '',
                  imagekitUrlEndpoint: data.imagekitUrlEndpoint || '',
                  siteUrl: data.siteUrl || '',
                  paymentStatus: data.paymentStatus || 'unpaid',
                  package: data.package || '1tr',
                  domain: data.domain || '',
                  domainExtension: data.domainExtension || '',
                  layout: data.layout || 'classic',
                  tabs: data.tabs || '',
                  language: data.language || 'vi-VN',
                });
              } else {
                setRole(UserRole.UNAUTHORIZED);
                setPendingStatus(data.status || null);
              }
            } else {
              setRole(UserRole.UNAUTHORIZED);
            }
            setIsLoading(false);
          }).catch(() => {
            // Fallback keep existing if fetch fails
            setRole(UserRole.SUB_ACCOUNT);
            setIsLoading(false);
          });
        }
        return; // Skip onAuthStateChanged initial load if custom session is active
      } catch (e) {
        console.error("Failed to parse saved session", e);
      }
    }

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      // Only set user from Google auth if there is no custom session
      const currentCustomSession = sessionStorage.getItem("yohu_custom_admin_user") || localStorage.getItem("yohu_custom_admin_user");
      if (currentCustomSession) return;

      setUser(u);
      if (u) {
        setIsAuthenticated(true);
        if (u.email === SUPER_ADMIN_EMAIL) {
          setRole(UserRole.SUPER_ADMIN);
          setPendingStatus(null);
        } else {
          try {
            const subAccountDoc = await getDoc(doc(db, 'authorized_emails', u.email || ''));
            if (subAccountDoc.exists()) {
              const data = subAccountDoc.data();
              if (data.isActive !== false) {
                setRole(UserRole.SUB_ACCOUNT);
                setPendingStatus(null);
                setUserConfig({
                  imagekitPrivateKey: data.imagekitPrivateKey || '',
                  imagekitPublicKey: data.imagekitPublicKey || '',
                  imagekitUrlEndpoint: data.imagekitUrlEndpoint || '',
                  siteUrl: data.siteUrl || '',
                  paymentStatus: data.paymentStatus || 'unpaid',
                  package: data.package || '1tr',
                  domain: data.domain || '',
                  domainExtension: data.domainExtension || '',
                  layout: data.layout || 'classic',
                  tabs: data.tabs || '',
                  language: data.language || 'vi-VN',
                });
              } else {
                setRole(UserRole.UNAUTHORIZED);
                setPendingStatus(data.status || null);
              }
            } else {
              await setDoc(doc(db, 'authorized_emails', u.email || ''), {
                isActive: false,
                requestDate: serverTimestamp(),
                displayName: u.displayName
              }, { merge: true });
              setRole(UserRole.UNAUTHORIZED);
              setPendingStatus(null);
            }
          } catch (e) {
            setRole(UserRole.UNAUTHORIZED);
            setPendingStatus(null);
          }
        }
      } else {
        setIsAuthenticated(false);
        setRole(UserRole.UNAUTHORIZED);
        setPendingStatus(null);
      }
      setIsLoading(false);
    });

    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    // Load data based on role
    let path = 'settings/siteContent'; // Default/Main
    if (role === UserRole.SUB_ACCOUNT && user?.email) {
      path = `users/${user.email}/siteContent`;
    }

    // Initial load from localStorage as fallback
    const localKey = `yohu_site_content_${role === UserRole.SUPER_ADMIN ? 'main' : user?.email || 'anon'}`;
    const savedData = localStorage.getItem(localKey);
    if (savedData) {
      try {
        setCustomData(JSON.parse(savedData));
      } catch (e) {
        console.error("Failed to parse local custom data", e);
      }
    }

    // Listen to firestore changes in real-time
    const unsub = onSnapshot(doc(db, path), (doc) => {
      if (doc.exists()) {
        const data = doc.data().content || {};
        setCustomData(data);
        localStorage.setItem(localKey, JSON.stringify(data));
      } else if (role === UserRole.SUB_ACCOUNT) {
        // If it's a new sub-account, maybe initialize with main template if requested
        // For now, default to empty or look for template
      }
    }, (err) => {
      // Don't error out for new sub-accounts that don't have a doc yet
      if (err.code !== 'permission-denied') {
        handleFirestoreError(err, OperationType.GET, path);
      }
    });

    return () => unsub();
  }, [user, role, isLoading]);

  const loginWithPassword = async (email: string, pass: string): Promise<boolean> => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPass = pass.trim();

    // Valid passwords: brand name, hotlines, and super password
    const validPasswords = [
      "yohu.vn",
      "0339606969",
      "yohu@2026",
      "0973480488",
    ];

    if (!validPasswords.includes(trimmedPass)) {
      throw new Error("Mật khẩu không chính xác!");
    }

    if (trimmedEmail === SUPER_ADMIN_EMAIL) {
      const customUser = {
        email: SUPER_ADMIN_EMAIL,
        displayName: "Yohu Super Admin",
        uid: "custom_super_admin_id"
      };
      setUser(customUser as any);
      setIsAuthenticated(true);
      setRole(UserRole.SUPER_ADMIN);
      setPendingStatus(null);
      sessionStorage.setItem("yohu_custom_admin_user", JSON.stringify(customUser));
      return true;
    } else {
      // Check if sub-account email is authorized
      try {
        const subAccountDoc = await getDoc(doc(db, 'authorized_emails', trimmedEmail));
        if (subAccountDoc.exists() && subAccountDoc.data().isActive !== false) {
          const data = subAccountDoc.data();
          const customUser = {
            email: trimmedEmail,
            displayName: data.displayName || "Admin Sub-Account",
            uid: "custom_sub_account_" + trimmedEmail.replace(/[^a-zA-Z0-9]/g, "")
          };
          setUser(customUser as any);
          setIsAuthenticated(true);
          setRole(UserRole.SUB_ACCOUNT);
          setPendingStatus(null);
          setUserConfig({
            imagekitPrivateKey: data.imagekitPrivateKey || '',
            imagekitPublicKey: data.imagekitPublicKey || '',
            imagekitUrlEndpoint: data.imagekitUrlEndpoint || '',
            siteUrl: data.siteUrl || '',
            paymentStatus: data.paymentStatus || 'unpaid',
            package: data.package || '1tr',
            domain: data.domain || '',
            domainExtension: data.domainExtension || '',
            layout: data.layout || 'classic',
            tabs: data.tabs || '',
            language: data.language || 'vi-VN',
          });
          sessionStorage.setItem("yohu_custom_admin_user", JSON.stringify(customUser));
          return true;
        } else if (subAccountDoc.exists()) {
          throw new Error("Tài khoản đang chờ phê duyệt!");
        } else {
          // Auto register as pending sub-account
          await setDoc(doc(db, 'authorized_emails', trimmedEmail), {
            isActive: false,
            requestDate: serverTimestamp(),
            displayName: trimmedEmail.split("@")[0]
          }, { merge: true });
          throw new Error("Tài khoản chưa được duyệt. Hệ thống đã lưu yêu cầu phê duyệt!");
        }
      } catch (err: any) {
        throw new Error(err.message || "Tài khoản không được duyệt");
      }
    }
  };

  const logoutUser = async () => {
    try {
      await signOut(auth);
    } catch (e) {}
    setUser(null);
    setIsAuthenticated(false);
    setRole(UserRole.UNAUTHORIZED);
    setPendingStatus(null);
    sessionStorage.removeItem("yohu_custom_admin_user");
    localStorage.removeItem("yohu_custom_admin_user");
    sessionStorage.removeItem("google_access_token");
  };

  const updateCustomData = async (key: string, value: any) => {
    setCustomData(prev => {
      const newData = { ...prev, [key]: value };
      
      let path = 'settings/siteContent';
      if (role === UserRole.SUB_ACCOUNT && user?.email) {
        path = `users/${user.email}/siteContent`;
      }

      const localKey = `yohu_site_content_${role === UserRole.SUPER_ADMIN ? 'main' : user?.email || 'anon'}`;
      localStorage.setItem(localKey, JSON.stringify(newData));
      
      setDoc(doc(db, path), {
        content: newData,
        email: user?.email,
        updatedAt: serverTimestamp()
      }, { merge: true }).catch(err => {
        handleFirestoreError(err, OperationType.WRITE, path);
      });

      return newData;
    });
  };

  return (
    <AdminContext.Provider value={{ 
      isAuthenticated, 
      setIsAuthenticated, 
      isEditMode, 
      setIsEditMode, 
      customData, 
      updateCustomData,
      user,
      role,
      userConfig,
      isLoading,
      pendingStatus,
      loginWithPassword,
      logoutUser
    }}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = () => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};
