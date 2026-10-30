import React, { useEffect, useState } from 'react';
import { SectionHeading } from './components';

/**
 * 桌面端工作区目录选择。浏览器模式没有该能力，只展示服务端管理的说明。
 * 切换目录需要重启应用生效，因为本地 API 在启动时就绑定了 dataDir。
 */
export function WorkspaceLocationCard() {
  const bridge = window.warpweft;
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!bridge?.getWorkspace) {
      setMessage('浏览器模式：工作区由服务端数据目录管理，桌面版可在此选择存放位置。');
      return;
    }
    void bridge
      .getWorkspace()
      .then((info) => {
        if (info?.path) setPath(info.path);
      })
      .catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : String(cause)));
  }, [bridge]);

  const choose = async () => {
    if (!bridge?.chooseWorkspace || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await bridge.chooseWorkspace();
      if (result.canceled) return;
      if (result.status === 'failed') {
        setMessage(result.error || '切换工作区失败');
        return;
      }
      if (result.path) setPath(result.path);
      setMessage(result.restartRequired ? '工作区位置已保存，重启应用后生效。' : '工作区位置已更新。');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section-panel workspace-location-card">
      <div className="panel-head">
        <SectionHeading title="工作区位置" />
        <button type="button" className="ghost-button" onClick={() => void choose()} disabled={busy || !bridge?.chooseWorkspace}>
          {busy ? '正在选择…' : '选择文件夹'}
        </button>
      </div>
      <p className="panel-note">数据库、长时任务检查点和缓存文件会保存在这个文件夹；切换后重启应用生效。</p>
      <div className="workspace-location-path">
        <span>当前路径</span>
        <code>{path || '读取中…'}</code>
      </div>
      {message ? <p className="panel-note">{message}</p> : null}
    </section>
  );
}
