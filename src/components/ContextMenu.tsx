export interface ContextMenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  return (
    <div
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {state.items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="context-sep" />
        ) : (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.action?.();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
