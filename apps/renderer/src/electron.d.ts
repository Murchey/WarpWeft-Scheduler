/**
 * Electron preload 桥的类型声明。渲染层通过 window.warpweft 判断是否运行在桌面壳内，
 * 浏览器访问时该对象不存在，调用方必须做可选链判断。
 */
export interface WarpweftWindowState {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
  platform: string;
}

export interface WarpweftBridgeResult {
  status?: string;
  path?: string;
  error?: string;
}

export interface WarpweftWorkspaceInfo {
  path: string;
  customizable: boolean;
}

export interface WarpweftBridge {
  platform: string;
  saveExport: (filename: string, data: ArrayBuffer) => Promise<WarpweftBridgeResult>;
  saveExports: (
    folderName: string,
    files: { filename: string; data: ArrayBuffer }[],
  ) => Promise<WarpweftBridgeResult & { files?: number; folderName?: string }>;
  showItemInFolder: (target: string) => Promise<{ ok: boolean; error?: string }>;
  getWorkspace: () => Promise<WarpweftWorkspaceInfo>;
  chooseWorkspace: () => Promise<{ canceled?: boolean; status?: string; path?: string; restartRequired?: boolean; error?: string }>;
  /** 以下方法仅新版桌面壳提供，浏览器端与旧版壳均为 undefined。 */
  minimize?: () => Promise<void>;
  toggleMaximize?: () => Promise<{ maximized: boolean } | undefined>;
  closeWindow?: () => Promise<void>;
  setTheme?: (theme: 'light' | 'dark') => Promise<void>;
  setLocale?: (locale: 'zh-CN' | 'en-US') => Promise<void>;
  onWindowState?: (callback: (state: WarpweftWindowState) => void) => () => void;
}

declare global {
  interface Window {
    warpweft?: WarpweftBridge;
  }
}

export {};
