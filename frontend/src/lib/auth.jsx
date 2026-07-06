import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null); // { email, is_admin } — vom Backend

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Wer bin ich? — sobald Session da ist einmal laden, Rolle cachen.
  useEffect(() => {
    if (!session) { setMe(null); return; }
    let cancelled = false;
    api('/me').then(m => { if (!cancelled) setMe(m); }).catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{
      session,
      user: session?.user || null,
      loading,
      me,
      isAdmin: !!me?.is_admin,
      signIn,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
