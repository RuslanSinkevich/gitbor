import type { ReactNode } from 'react';

export interface SgTableColumn<T> {
  key: string;
  title: string;
  width?: number | string;
  render?: (row: T, index: number) => ReactNode;
}

interface SgTableProps<T> {
  columns: SgTableColumn<T>[];
  data: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T, index: number) => void;
  selectedKey?: string | null;
  className?: string;
}

export function SgTable<T>({ columns, data, rowKey, onRowClick, selectedKey, className = '' }: SgTableProps<T>) {
  return (
    <div className={`sg-table-wrapper ${className}`.trim()}>
      <table className="sg-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const key = rowKey(row, i);
            return (
              <tr
                key={key}
                className={key === selectedKey ? 'sg-table-row--selected' : ''}
                onClick={() => onRowClick?.(row, i)}
              >
                {columns.map(col => (
                  <td key={col.key}>
                    {col.render ? col.render(row, i) : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
