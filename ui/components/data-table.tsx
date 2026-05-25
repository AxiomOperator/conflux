"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  className?: string;
  header: string;
  key: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => number | string | null | undefined;
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  emptyMessage = "No rows to display.",
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  data: T[];
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}) {
  const defaultSort = columns.find((column) => column.sortable)?.key ?? null;
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [sortKey, setSortKey] = useState<string | null>(defaultSort);

  const sortedRows = useMemo(() => {
    if (!sortKey) {
      return data;
    }

    const column = columns.find((entry) => entry.key === sortKey);
    if (!column) {
      return data;
    }

    return [...data].sort((left, right) => {
      const leftValue = column.sortValue
        ? column.sortValue(left)
        : (left as Record<string, unknown>)[sortKey];
      const rightValue = column.sortValue
        ? column.sortValue(right)
        : (right as Record<string, unknown>)[sortKey];

      if (leftValue === rightValue) {
        return 0;
      }

      if (leftValue === null || leftValue === undefined) {
        return 1;
      }

      if (rightValue === null || rightValue === undefined) {
        return -1;
      }

      const comparison = String(leftValue).localeCompare(
        String(rightValue),
        undefined,
        {
          numeric: true,
          sensitivity: "base",
        },
      );

      return direction === "asc" ? comparison : -comparison;
    });
  }, [columns, data, direction, sortKey]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => {
            const isSorted = sortKey === column.key;
            const Icon = !column.sortable
              ? null
              : !isSorted
                ? ArrowUpDown
                : direction === "asc"
                  ? ArrowUp
                  : ArrowDown;

            return (
              <TableHead key={column.key} className={column.className}>
                {column.sortable ? (
                  <Button
                    variant="ghost"
                    className="-ml-3 h-8 px-3"
                    onClick={() => {
                      if (sortKey === column.key) {
                        setDirection((current) =>
                          current === "asc" ? "desc" : "asc",
                        );
                        return;
                      }

                      setSortKey(column.key);
                      setDirection("asc");
                    }}
                  >
                    {column.header}
                    {Icon ? <Icon className="size-4" /> : null}
                  </Button>
                ) : (
                  column.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.length > 0 ? (
          sortedRows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(onRowClick && "cursor-pointer")}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((column) => (
                <TableCell
                  key={`${row.id}-${column.key}`}
                  className={column.className}
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="py-8 text-center text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
