import { useCallback, useEffect, useState } from 'react';
import {
  fetchHealth,
  fetchOverview,
  forgetSession,
  hasToken,
  login,
  type HealthInfo,
  type Overview,
  SiteApiError,
} from './serverApi';

export type StatusPhase = 'loading' | 'offline' | 'anonymous' | 'signedOut' | 'ready';

const INTERVAL_READY = 10000;
const INTERVAL_IDLE = 30000;
const INTERVAL_HIDDEN = 4000;

/**
 * 服务端状态轮询。
 *
 * 只读：全程只调用 GET /api/health、GET /api/server/overview 与 POST /api/auth/login，
 * 不提供取消任务、删除任务、修改配置或注销用户等写操作。
 */
export function useServerStatus() {
  const [phase, setPhase] = useState<StatusPhase>('loading');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [expired, setExpired] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const refresh = useCallback(async (): Promise<number> => {
    try {
      const next = await fetchHealth();
      setHealth(next);
      setUpdatedAt(Date.now());
      if (!next.auth?.required) {
        setOverview(null);
        setPhase('anonymous');
        return INTERVAL_IDLE;
      }
      if (!hasToken()) {
        setOverview(null);
        setPhase('signedOut');
        return INTERVAL_IDLE;
      }
      const data = await fetchOverview();
      setOverview(data);
      setExpired(false);
      setPhase('ready');
      return INTERVAL_READY;
    } catch (error) {
      if (error instanceof SiteApiError && error.status === 401) {
        // 401 时凭证已在 serverApi 内清除，这里只负责把面板切回登录态
        setOverview(null);
        setExpired(true);
        setPhase('signedOut');
        return INTERVAL_IDLE;
      }
      setPhase('offline');
      return INTERVAL_IDLE;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let handle = 0;

    const loop = async () => {
      if (cancelled) return;
      if (paused || document.visibilityState === 'hidden') {
        handle = window.setTimeout(loop, INTERVAL_HIDDEN);
        return;
      }
      const delay = await refresh();
      if (!cancelled) handle = window.setTimeout(loop, delay);
    };
    void loop();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') setRound((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [paused, refresh, round]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      setSigningIn(true);
      setLoginError(null);
      try {
        await login(username, password);
        setExpired(false);
        await refresh();
      } catch (error) {
        setLoginError(error instanceof Error ? error.message : '登录失败');
      } finally {
        setSigningIn(false);
      }
    },
    [refresh],
  );

  const manualRefresh = useCallback(() => {
    setRound((value) => value + 1);
  }, []);

  /** 只丢弃浏览器本地凭证，不调用服务端注销接口。 */
  const forget = useCallback(() => {
    forgetSession();
    setOverview(null);
    setExpired(false);
    setLoginError(null);
    setPhase('signedOut');
  }, []);

  return {
    phase,
    health,
    overview,
    updatedAt,
    paused,
    expired,
    signingIn,
    loginError,
    setPaused,
    signIn,
    manualRefresh,
    forget,
  };
}
