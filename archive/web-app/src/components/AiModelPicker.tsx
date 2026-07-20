import { Menu } from "@base-ui/react/menu";
import {
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  CpuIcon as Cpu
} from "@phosphor-icons/react";
import { AI_MODEL_OPTIONS, aiModelLabel, type AiModel } from "@/lib/ai-preferences";
import styles from "./AiModelPicker.module.css";

export default function AiModelPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  side = "bottom"
}: {
  value: AiModel;
  onChange: (model: AiModel) => void;
  disabled?: boolean;
  compact?: boolean;
  side?: "top" | "bottom";
}) {
  return <Menu.Root modal={false} disabled={disabled}>
    <Menu.Trigger className={`${styles.trigger} ${compact ? styles.compact : ""}`} aria-label={`Model: ${aiModelLabel(value)}`}>
      <Cpu size={compact ? 14 : 15} aria-hidden />
      <span>{aiModelLabel(value)}</span>
      <CaretDown size={12} aria-hidden />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner className={styles.positioner} side={side} align="start" sideOffset={6} collisionPadding={10}>
        <Menu.Popup className={styles.popup}>
          <div className={styles.heading}>Model</div>
          <Menu.RadioGroup value={value} onValueChange={(next) => onChange(next as AiModel)}>
            {AI_MODEL_OPTIONS.map((option) => <Menu.RadioItem className={styles.item} value={option.value} closeOnClick key={option.value}>
              <span className={styles.indicator}><Menu.RadioItemIndicator><Check size={13} weight="bold" /></Menu.RadioItemIndicator></span>
              <span className={styles.copy}><strong>{option.label}{option.recommended ? <em>Recommended</em> : null}</strong><small>{option.description}</small></span>
            </Menu.RadioItem>)}
          </Menu.RadioGroup>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
