import React from 'react';

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
}) {
  const visibleRows = previewCount === undefined ? rows : rows.slice(0, Math.max(0, previewCount));
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
                <tr key={row.id}>
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
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
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

