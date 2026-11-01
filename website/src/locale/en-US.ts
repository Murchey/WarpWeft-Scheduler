import type { SiteKey } from './zh-CN';

/**
 * 英文覆盖表。故意保持为 Partial：缺条目自动回落中文，
 * 界面永远不会出现空白（与产品 i18n 的回退策略一致）。
 */
export const enUS: Partial<Record<SiteKey, string>> = {
  'brand.title': 'WarpWeft Scheduler',

  'nav.overview': 'Product',
  'nav.features': 'Features',
  'nav.shots': 'Interface',
  'nav.status': 'Status',
  'nav.deploy': 'Deploy',
  'nav.enterApp': 'Server status',

  'theme.switch': 'Theme',
  'lang.switch': 'EN',
  'lang.switchBack': '中文',

  'hero.kicker': 'WarpWeft Scheduler',
  'hero.lead':
    'Timetabling for single machines and small LANs: an Electron/React interface, a local JSON data layer, and a standalone Java 21 solver. Your data stays on your own machine or server — no cloud dependency.',
  'hero.ctaApp': 'View status',
  'hero.ctaDeploy': 'How to deploy',
  'hero.ctaDownload': 'Download desktop app',
  'hero.tag.desktop': 'Electron desktop app',
  'hero.tag.local': 'Local JSON data layer',
  'hero.tag.solver': 'Standalone Java 21 solver',
  'hero.tag.selfhost': 'Self-hostable',
  'hero.note': 'The Linux server serves the site, live status and the API. Timetabling happens in the desktop app; admins can sign in here to inspect load and queue.',

  'metrics.title': 'Scale and performance',
  'metrics.lead': 'Figures come from a real workspace and solver benchmarks; treat them as capability hints.',

  'features.title': 'Features',
  'features.lead': 'From data preparation through solving, adjustments, export and release.',

  'shots.title': 'Interface',
  'shots.lead': 'One interface for both the desktop app and the Linux server. Click to enlarge.',
  'shots.close': 'Close',

  'status.title': 'Server status',
  'status.lead':
    'Read-only panel: load, solver state and job queue of this server. No cancel or delete actions are offered.',
  'status.offline': 'Server unreachable',
  'status.offlineHint': 'The health endpoint could not be reached; retrying in 30 seconds.',
  'status.anonymous': 'This instance has server login disabled',
  'status.anonymousHint': 'Only minimal public metadata is shown; jobs and logs stay hidden.',
  'status.signinTitle': 'Sign in to see server status',
'status.signinHint': 'Sign in with your server account. Admins see the full panel; regular accounts do not.',
  'status.username': 'Username',
  'status.password': 'Password',
  'status.login': 'Sign in',
  'status.loggingIn': 'Signing in…',
  'status.sessionExpired': 'Session expired (server restarted or 12 hours elapsed). Please sign in again.',
  'status.cpu': 'CPU',
  'status.memory': 'Memory',
  'status.uptime': 'Uptime',
  'status.solver': 'Solver',
  'status.queue': 'Queue',
  'status.clients': 'Connected',
  'status.java': 'Java',
  'status.solverReady': 'ready',
  'status.solverDown': 'not ready',
  'status.jobs': 'Recent jobs',
  'status.job.id': 'Job',
  'status.job.status': 'Status',
  'status.job.lessons': 'Lessons',
  'status.job.entries': 'Placed',
  'status.job.elapsed': 'Elapsed',
  'status.job.finished': 'Finished',
  'status.job.empty': 'No jobs yet',
  'status.logs': 'Solver log',
  'status.logsEmpty': 'No log entries',
  'status.refresh': 'Refresh',
  'status.pause': 'Pause polling',
  'status.resume': 'Resume polling',
  'status.forget': 'Forget session here',
  'status.forgetHint':
    'Clears the credential stored in this browser. This is local only — the server logout endpoint is not called (the session still expires after 12 hours).',
  'status.paused': 'Polling paused',
  'status.updated': 'Updated',
  'status.maskNote': 'IP addresses and account names in the log are masked.',
  'status.publicInfo': 'Version',

  'deploy.title': 'Deployment',
  'deploy.lead': 'Drop the package onto any Linux server and change one line of Nginx config.',
  'deploy.paths': 'Paths',
  'deploy.pathRoot': 'Product site (public)',
  'deploy.pathApp': 'Desktop UI is not served here',
  'deploy.pathApi': 'Backend API (login required)',

  'footer.built': 'Site and app are served by the same Node service.',
  'footer.docs': 'See guideline.md inside the package for the full deployment guide',
  'footer.rights': 'All rights reserved.',

  'notice.privateTag': 'Private instance',
  'notice.privateBody': "This page is privately configured by its operator and is not the developer's official website.",
  'notice.announceTag': 'Notice',
  'notice.expand': 'Show',
  'notice.collapse': 'Hide',
  'notice.dismiss': 'Dismiss notice',
};
