import type { KeyboardEvent } from "react";

export interface WorkspaceTab<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export default function WorkspaceTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className = ""
}: {
  items: WorkspaceTab<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`workspace-tabs ${className}`.trim()} role="tablist" aria-label={label}>
        {items.map((item) => {
          const active = item.id === value;
          const focusTab = (event: KeyboardEvent<HTMLButtonElement>) => {
            const currentIndex = items.findIndex((candidate) => candidate.id === item.id);
            let nextIndex: number;
            if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
            else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = items.length - 1;
            else return;
            event.preventDefault();
            onChange(items[nextIndex].id);
            const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
            buttons?.[nextIndex]?.focus();
          };
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={active ? "active" : ""}
              onClick={() => onChange(item.id)}
              onKeyDown={focusTab}
              key={item.id}
            >
              <span>{item.label}</span>
              {typeof item.count === "number" && <strong>{item.count}</strong>}
            </button>
          );
        })}
    </div>
  );
}
