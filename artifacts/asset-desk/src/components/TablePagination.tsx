import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const ROWS_OPTIONS = [10, 20, 30, 40, 50, 100];

interface TablePaginationProps {
  total:               number;
  page:                number;
  rowsPerPage:         number;
  onPageChange:        (page: number) => void;
  onRowsPerPageChange: (rpp: number) => void;
  noun?:               string;
}

export default function TablePagination({
  total, page, rowsPerPage, onPageChange, onRowsPerPageChange, noun = "rows",
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  const from = total === 0 ? 0 : (page - 1) * rowsPerPage + 1;
  const to   = Math.min(page * rowsPerPage, total);

  return (
    <div className="flex items-center justify-between gap-4 border-t border-border bg-background px-4 py-2 text-sm flex-wrap">
      {/* Rows per page */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">Rows per page:</span>
        <Select
          value={String(rowsPerPage)}
          onValueChange={v => { onRowsPerPageChange(Number(v)); onPageChange(1); }}
        >
          <SelectTrigger className="h-7 w-[66px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROWS_OPTIONS.map(n => (
              <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Showing info */}
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {total === 0
          ? `0 ${noun}`
          : `Showing ${from}–${to} of ${total} ${noun}`}
      </span>

      {/* Navigation */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          title="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="mx-2 text-xs text-muted-foreground whitespace-nowrap">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          title="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          title="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
