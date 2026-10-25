import React, { useRef } from 'react';

export const DAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function SectionHeading({ english, title }: { english: string; title: string }) {
  return (
    <div className="section-heading">
      <span className="kicker">// {english}</span>
      <h2>{title}</h2>
    </div>
  );
}

type Column<T> = {
  key: keyof T & string;
  label: string;
  type?: 'text' | 'number' | 'select' | 'classes';
  options?: { value: string; label: string }[];
  width?: string;
  defaultValue?: string | number;
};

function EditableTable<T extends { id: string }>({
  title,
  english,
  rows,
  columns,
  onChange,
  onAdd,
  onRemove,
  addLabel,
  note,
  previewCount,
  onOpenAll,
  onEditClasses,
  highlightId,
}: {
  title: string;
  english: string;
  rows: T[];
  columns: Column<T>[];
  onChange: (id: string, key: string, value: string | number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  addLabel: string;
  note?: string;
  /** Show only this many rows in the outer panel; the rest live in the workspace. */
  previewCount?: number;
  onOpenAll?: () => void;
  onEditClasses?: (id: string) => void;
  /** Newly added row: keep it visible even beyond previewCount and focus its first input. */
  highlightId?: string;
}) {
  const previewRows = previewCount === undefined ? rows : rows.slice(0, Math.max(0, previewCount));
  const highlightedRow = highlightId ? rows.find((row) => row.id === highlightId) : undefined;
  const visibleRows =
    highlightedRow && !previewRows.some((row) => row.id === highlightedRow.id)
      ? [...previewRows, highlightedRow]
      : previewRows;
  const focusColumnKey = columns.find((column) => column.type !== 'select' && column.type !== 'classes')?.key;
  const selectedOnFocus = useRef<string | null>(null);
  return (
    <section className="section-panel resource-panel">
      <div className="panel-head">
        <SectionHeading english={english} title={title} />
        <div className="panel-head-actions">
          {onOpenAll ? (
            <button className="ghost-button" onClick={onOpenAll}>
              查看全部（{rows.length}）
            </button>
          ) : null}
          <button className="mini-button" onClick={onAdd}>
            + {addLabel}
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ width: column.width }}>
                  {column.label}
                </th>
              ))}
              <th className="action-column">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="table-empty" colSpan={columns.length + 1}>
                  暂无数据，点击右上角新增。
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.id} className={row.id === highlightId ? 'is-new' : undefined}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.type === 'classes' ? (
                        <button
                          type="button"
                          className="classes-trigger"
                          onClick={() => onEditClasses?.(row.id)}
                          title="点击选择负责班级"
                        >
                          <span>
                            {String(row[column.key] ?? column.defaultValue ?? '').trim() || '全部班级（不限）'}
                          </span>
                          <em>编辑</em>
                        </button>
                      ) : column.type === 'select' ? (
                        <select
                          value={String(row[column.key] ?? column.defaultValue ?? '')}
                          onChange={(event) => onChange(row.id, column.key, event.target.value)}
                        >
                          {column.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={column.type === 'number' ? 'number' : 'text'}
                          min={column.type === 'number' ? 0 : undefined}
                          value={String(row[column.key] ?? column.defaultValue ?? '')}
                          autoFocus={row.id === highlightId && column.key === focusColumnKey}
                          onFocus={(event) => {
                            if (row.id === highlightId && column.key === focusColumnKey && selectedOnFocus.current !== row.id) {
                              selectedOnFocus.current = row.id;
                              event.currentTarget.select();
                            }
                          }}
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
                  <td className="action-column">
                    {row.id === highlightId ? <span className="table-new-badge">新增</span> : null}
                    <button className="danger-link" onClick={() => onRemove(row.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {note ? <p className="panel-note">{note}</p> : null}
    </section>
  );
}

export { SectionHeading, EditableTable };
export type { Column };

