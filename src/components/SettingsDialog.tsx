import { Dialog } from "@base-ui/react/dialog";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import styles from "./SettingsDialog.module.css";

export interface SettingsDialogItem {
  id: string;
  label: string;
  icon: Icon;
}

interface Props {
  open: boolean;
  activeId: string;
  description: string;
  items: SettingsDialogItem[];
  onNavigate: (id: string) => void;
  onClose: () => void;
  children: ReactNode;
}

export default function SettingsDialog({
  open,
  activeId,
  description,
  items,
  onNavigate,
  onClose,
  children
}: Props) {
  return <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className={styles.backdrop} />
      <Dialog.Viewport className={styles.viewport}>
        <Dialog.Popup className={styles.popup}>
          <header className={styles.header}>
            <div>
              <Dialog.Title className={styles.title}>Settings</Dialog.Title>
              <Dialog.Description className={styles.description}>{description}</Dialog.Description>
            </div>
            <Dialog.Close className={styles.close} aria-label="Close settings">
              <X size={18} weight="bold" aria-hidden />
            </Dialog.Close>
          </header>
          <div className={styles.layout}>
            <nav className={styles.navigation} aria-label="Settings sections">
              {items.map((item) => {
                const ItemIcon = item.icon;
                const active = item.id === activeId;
                return <button
                  key={item.id}
                  className={active ? styles.active : undefined}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  <ItemIcon size={17} weight={active ? "fill" : "regular"} aria-hidden />
                  <span>{item.label}</span>
                </button>;
              })}
            </nav>
            <div className={styles.content}>{children}</div>
          </div>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
