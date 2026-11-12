import React from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { TabStrip } from './TabStrip';

/** The main window's tab bar. Hidden in the split layout, where each pane shows its own TabStrip. */
export const TabBar: React.FC = () => {
  const tabs = useExplorerStore((s) => s.tabs);
  const activeTabId = useExplorerStore((s) => s.activeTabId);
  const switchTab = useExplorerStore((s) => s.switchTab);
  const closeTab = useExplorerStore((s) => s.closeTab);
  const addTab = useExplorerStore((s) => s.addTab);
  const reorderTabs = useExplorerStore((s) => s.reorderTabs);

  return (
    <TabStrip
      items={tabs.map((t) => ({ id: t.id, title: t.title, path: t.path }))}
      activeId={activeTabId}
      onSelect={(id) => void switchTab(id)}
      onClose={(id) => void closeTab(id)}
      onAdd={() => void addTab()}
      onReorder={reorderTabs}
    />
  );
};
