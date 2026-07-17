import { useTabsStore } from "../stores/tabsStore";

export function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const closeTab = useTabsStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          role="tab"
          aria-selected={tab.id === activeTabId}
        >
          <button
            type="button"
            className="tab-label"
            onClick={() => setActiveTab(tab.id)}
            title={tab.originalPath}
          >
            {tab.fileName}
          </button>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${tab.fileName}`}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
