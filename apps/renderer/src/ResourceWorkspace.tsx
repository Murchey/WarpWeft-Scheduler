import React, { useEffect, useMemo, useState } from 'react';
import type { Column } from './components';

export interface BatchField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface ResourceWorkspaceProps<T extends { id: string }> {
  title: string;
  english: string;
  rows: T[];
  columns: Column<T>[];
  batchFields: BatchField[];
  searchText: (row: T) => string;
  onChange: (id: string, key: string, value: string | number) => void;
  onBatchEdit: (ids: string[], key: string, value: string | number) => void;
  onRemoveMany: (ids: string[]) => void;
  onClose: () => void;
  note?: string;
}

const PAGE_SIZE = 40;

function ResourceWorkspace<T extends { id: string }>({
  title,
  english,
  rows,
  columns,
  batchFields,
  searchText,
  onChange,
  onBatchEdit,
  onRemoveMany,
  onClose,
  note,
}: ResourceWorkspaceProps<T>) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [batchKey, setBatchKey] = useState('');
  const [batchValue, setBatchValue] = useState<string>('');
  const [feedback, setFeedback] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => searchText(row).toLowerCase().includes(needle));
  }, [rows, query, searchText]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const visibleIds = visible.map((row) => row.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  const selectedSet = new Set(selected);
  const batchField = batchFields.find((field) => field.key === batchKey);

  useEffect(() => {
    setPage(0);
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const field = batchFields.find((item) => item.key === batchKey);
    setBatchValue(field?.type === 'select' ? field.options?.[0]?.value ?? '' : '');
  }, [batchKey]);

  const toggleRow = (id: string) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };
  const toggleVisible = () => {
    setSelected((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      const merged = new Set([...current, ...visibleIds]);
      return Array.from(merged);
    });
  };
  const selectAllFiltered = () => setSelected(filtered.map((row) => row.id));

  const applyBatch = () => {
    if (!batchField || selected.length === 0) return;
    const value = batchField.type === 'number' ? Number(batchValue) : batchValue;
    if (batchField.type === 'number' && !Number.isFinite(value)) return;
    onBatchEdit(selected, batchField.key, value);
    setFeedback('已把 ' + selected.length + ' 条记录的「' + batchField.label + '」改为 ' + String(value) + '。');
    setBatchValue(batchField.type === 'select' ? batchField.options?.[0]?.value ?? '' : '');
  };

  const removeSelected = () => {
    if (selected.length === 0) return;
    if (!window.confirm('删除选中的 ' + selected.length + ' 条记录？相关候选课表会清空。')) return;
    onRemoveMany(selected);
    setSelected([]);
    setFeedback('已删除 ' + selected.length + ' 条记录。');
  };

  return (
    <div
      className="resource-workspace-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="resource-workspace">
        <header className="resource-workspace-head">
          <div>
            <span className="kicker">// {english}</span>
            <h2>{title}</h2>
            <p>共 {rows.length} 条；可按关键词查找、逐条修改，或勾选后批量编辑/删除。</p>
          </div>
          <button type="button" className="resource-workspace-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="resource-workspace-toolbar">
          <input
            className="resource-workspace-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任意字段（名称、教师、类型…）"
            aria-label="搜索记录"
          />
          <span className="resource-workspace-selection">
            已选 <b>{selected.length}</b> / 筛选结果 <b>{filtered.length}</b>
            {selected.length > 0 ? (
              <button type="button" className="resource-workspace-link" onClick={() => setSelected([])}>清除选择</button>
            ) : null}
          </span>
          <button type="button" className="ghost-button" onClick={selectAllFiltered} disabled={filtered.length === 0}>
            全选筛选结果
          </button>

          <div className="resource-workspace-batch">
            <select value={batchKey} onChange={(event) => setBatchKey(event.target.value)} aria-label="批量修改字段">
              <option value="">批量修改字段…</option>
              {batchFields.map((field) => (
                <option key={field.key} value={field.key}>{field.label}</option>
              ))}
            </select>
            {batchField ? (
              batchField.type === 'select' ? (
                <select value={batchValue} onChange={(event) => setBatchValue(event.target.value)} aria-label="批量修改值">
                  {batchField.options?.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={batchField.type === 'number' ? 'number' : 'text'}
                  value={batchValue}
                  onChange={(event) => setBatchValue(event.target.value)}
                  placeholder={batchField.placeholder ?? '新值'}
                  aria-label="批量修改值"
                />
              )
            ) : null}
            <button type="button" className="action-button" onClick={applyBatch} disabled={!batchField || selected.length === 0}>
              应用到选中
            </button>
            <button type="button" className="danger-link resource-workspace-delete" onClick={removeSelected} disabled={selected.length === 0}>
              删除选中
            </button>
          </div>
        </div>

        <div className="resource-workspace-table">
          <table className="data-table resource-workspace-data">
            <thead>
              <tr>
                <th className="resource-workspace-check">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisible}
                    aria-label="选择当前页"
                    disabled={visible.length === 0}
                  />
                </th>
                {columns.map((column) => (
                  <th key={column.key} style={{ width: column.width }}>{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="table-empty" colSpan={columns.length + 1}>没有匹配的记录。</td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr key={row.id} className={selectedSet.has(row.id) ? 'is-selected' : ''}>
                    <td className="resource-workspace-check">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label={'选择 ' + searchText(row)}
                      />
                    </td>
                    {columns.map((column) => (
                      <td key={column.key}>
                        {column.type === 'classes' ? (
                          <select
                            multiple
                            className="classes-select"
                            value={String(row[column.key] ?? column.defaultValue ?? '')
                              .split(/[,，;；、]+/)
                              .map((item) => item.trim())
                              .filter(Boolean)}
                            onChange={(event) =>
                              onChange(
                                row.id,
                                column.key,
                                Array.from(event.target.selectedOptions).map((option) => option.value).join('、'),
                              )
                            }
                          >
                            {column.options?.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : column.type === 'select' ? (
                          <select
                            value={String(row[column.key] ?? column.defaultValue ?? '')}
                            onChange={(event) => onChange(row.id, column.key, event.target.value)}
                          >
                            {column.options?.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={column.type === 'number' ? 'number' : 'text'}
                            min={column.type === 'number' ? 0 : undefined}
                            value={String(row[column.key] ?? column.defaultValue ?? '')}
                            onChange={(event) =>
                              onChange(
                                row.id,
                                column.key,
                                column.type === 'number' ? Number(event.target.value) : event.target.value,
                              )
                            }
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="resource-workspace-foot">
          <span>
            第 {currentPage + 1} / {pageCount} 页 · 本页 {visible.length} 条
          </span>
          {feedback ? <span className="resource-workspace-feedback" role="status">{feedback}</span> : null}
          <div className="resource-workspace-pager">
            <button type="button" className="ghost-button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={currentPage === 0}>
              上一页
            </button>
            <button type="button" className="ghost-button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={currentPage >= pageCount - 1}>
              下一页
            </button>
          </div>
          {note ? <p className="panel-note">{note}</p> : null}
        </footer>
      </div>
    </div>
  );
}

export { ResourceWorkspace };


