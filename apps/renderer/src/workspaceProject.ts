import type { SchoolData } from './types';

export const WORKSPACE_FORMAT = 'warpweft-workspace';
export const WORKSPACE_VERSION = 1;
const PROJECTS_KEY = 'warpweft-workspace-projects';

export interface WorkspaceProject {
  id: string;
  name: string;
  savedAt: string;
  data: SchoolData;
}

export interface WorkspaceFile {
  format: typeof WORKSPACE_FORMAT;
  version: number;
  name: string;
  savedAt: string;
  data: SchoolData;
}

function projectId(): string {
  return 'project-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function workspaceFileName(name: string, suffix = '.workspace.json'): string {
  const safe = (name.trim() || 'warpweft-workspace').replace(/[\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  return safe.endsWith(suffix) ? safe : safe + suffix;
}

export function serializeWorkspace(data: SchoolData, name = data.school.name || 'WarpWeft 工作区'): string {
  const file: WorkspaceFile = {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    name: name.trim() || 'WarpWeft 工作区',
    savedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(file, null, 2);
}

export function parseWorkspace(text: string): WorkspaceFile {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('工作区文件不是有效 JSON');
  const file = parsed as Partial<WorkspaceFile>;
  if (file.format !== WORKSPACE_FORMAT) throw new Error('这不是 WarpWeft 工作区文件');
  if (!file.data || typeof file.data !== 'object') throw new Error('工作区文件缺少数据');
  const data = file.data as SchoolData;
  if (!Array.isArray(data.classes) || !Array.isArray(data.teachers) || !Array.isArray(data.coursePlans) || !Array.isArray(data.timeSlots)) {
    throw new Error('工作区数据缺少班级、教师、教学计划或时间段');
  }
  return {
    format: WORKSPACE_FORMAT,
    version: Number(file.version) || WORKSPACE_VERSION,
    name: typeof file.name === 'string' ? file.name : '导入的工作区',
    savedAt: typeof file.savedAt === 'string' ? file.savedAt : new Date().toISOString(),
    data,
  };
}

export function readWorkspaceProjects(): WorkspaceProject[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is WorkspaceProject => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && item.data));
  } catch {
    return [];
  }
}

function writeWorkspaceProjects(projects: WorkspaceProject[]): void {
  try { window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects.slice(0, 20))); } catch { /* local storage may be unavailable or full */ }
}

export function saveWorkspaceProject(name: string, data: SchoolData, existingId?: string): WorkspaceProject {
  const projects = readWorkspaceProjects();
  const saved: WorkspaceProject = { id: existingId || projectId(), name: name.trim() || data.school.name || '未命名工作项目', savedAt: new Date().toISOString(), data };
  writeWorkspaceProjects([saved, ...projects.filter((item) => item.id !== saved.id)]);
  return saved;
}

export function deleteWorkspaceProject(id: string): void {
  writeWorkspaceProjects(readWorkspaceProjects().filter((item) => item.id !== id));
}
