import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { KenneyIcon } from './KenneyIcon';
import { ICON_CATEGORIES, ICON_CATALOG } from './iconCatalog';

export const QUICK_ACCESS_COLORS = [
  '#38bdf8', // Sky
  '#60a5fa', // Blue
  '#818cf8', // Indigo
  '#a78bfa', // Violet
  '#c084fc', // Purple
  '#e879f9', // Fuchsia
  '#f472b6', // Pink
  '#fb7185', // Rose
  '#f87171', // Red
  '#fb923c', // Orange
  '#facc15', // Amber
  '#fde047', // Yellow
  '#a3e635', // Lime
  '#4ade80', // Green
  '#34d399', // Emerald
  '#2dd4bf', // Teal
  '#22d3ee', // Cyan
  '#94a3b8', // Slate
];

interface Props {
  title: string;
  initialIcon: string;
  initialColor: string;
  saveLabel?: string;
  onSave: (icon: string, color: string) => void;
  onClose: () => void;
}

/** Modal icon + color picker. Mount it only while open so state resets per use. */
export const IconPickerDialog: React.FC<Props> = ({ title, initialIcon, initialColor, saveLabel = 'Save Icon', onSave, onClose }) => {
  const [selectedIcon, setSelectedIcon] = useState(initialIcon);
  const [selectedColor, setSelectedColor] = useState(initialColor);
  const [iconSearchQuery, setIconSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredIcons = useMemo(() => {
    let list = ICON_CATALOG;
    if (selectedCategory !== 'all') list = list.filter((item) => item.category === selectedCategory);
    const q = iconSearchQuery.trim().toLowerCase();
    if (q) list = list.filter((item) => item.id.toLowerCase().includes(q) || item.label.toLowerCase().includes(q));
    return list;
  }, [selectedCategory, iconSearchQuery]);

  // Virtualized grid: column count follows container width (cell ~56px + 8px gap).
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(600);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setGridWidth(el.clientWidth));
    ro.observe(el);
    setGridWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const GAP = 8;
  const PAD = 8;
  const columns = Math.max(1, Math.floor((gridWidth - PAD * 2 + GAP) / (56 + GAP)));
  const cellSize = (gridWidth - PAD * 2 - GAP * (columns - 1)) / columns;
  const rowCount = Math.ceil(filteredIcons.length / columns);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => gridRef.current,
    estimateSize: () => cellSize + GAP,
    overscan: 4,
    paddingStart: PAD,
    paddingEnd: PAD,
  });
  useEffect(() => {
    rowVirtualizer.measure();
    gridRef.current?.scrollTo({ top: 0 });
  }, [selectedCategory, iconSearchQuery, cellSize, rowVirtualizer]);

  const activeIconItem = useMemo(() => ICON_CATALOG.find((item) => item.id === selectedIcon), [selectedIcon]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-xl bg-[#161922] border border-[var(--border)] shadow-2xl p-4 space-y-3.5 text-xs"
          >
            {/* Header + Live Preview */}
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-[var(--card)] border border-[var(--border)] flex items-center justify-center shrink-0 shadow-xs">
                  <KenneyIcon name={selectedIcon} size={22} color={selectedColor} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--foreground)]/85 text-sm truncate">
                    {title}
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-1.5 truncate">
                    <span>Icon:</span>
                    <span className="text-[var(--foreground)] font-medium">
                      {activeIconItem?.label || selectedIcon}
                    </span>
                    <span className="px-1.5 py-px rounded bg-white/[0.06] text-[9px] font-mono text-[var(--muted-foreground)]">
                      {selectedIcon}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onClose()}
                className="w-7 h-7 rounded-md hover:bg-white/[0.08] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer transition-colors"
              >
                <KenneyIcon name="cross" size={13} />
              </button>
            </div>

            {/* Icon Search & Filter Section */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Select Icon ({filteredIcons.length} available)
                </span>
                {iconSearchQuery && (
                  <span className="text-[10px] text-sky-400 font-mono">
                    Filtered by &ldquo;{iconSearchQuery}&rdquo;
                  </span>
                )}
              </div>

              {/* Search Bar */}
              <div className="relative flex items-center">
                <span className="absolute left-2.5 text-[var(--muted-foreground)] pointer-events-none flex items-center">
                  <KenneyIcon name="zoom" size={12} />
                </span>
                <input
                  type="text"
                  placeholder="Search 1,500+ icons (e.g. cloud, code, git, star, media, heart)..."
                  value={iconSearchQuery}
                  onChange={(e) => setIconSearchQuery(e.target.value)}
                  className="w-full bg-[var(--background)] text-[var(--foreground)] pl-8 pr-7 py-1.5 rounded-lg border border-[var(--border)] text-xs placeholder:text-[var(--muted-foreground)]/60 focus:border-sky-400 outline-none transition-colors"
                />
                {iconSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setIconSearchQuery('')}
                    className="absolute right-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer p-0.5 rounded hover:bg-white/[0.08]"
                  >
                    <KenneyIcon name="cross" size={10} />
                  </button>
                )}
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar">
                {ICON_CATEGORIES.map((cat) => {
                  const active = selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-medium whitespace-nowrap cursor-pointer transition-all flex items-center gap-1.5 shrink-0 ${
                        active
                          ? 'bg-sky-500 text-white shadow-xs font-semibold'
                          : 'bg-white/[0.04] text-[var(--muted-foreground)] hover:bg-white/[0.08] hover:text-[var(--foreground)]'
                      }`}
                    >
                      <KenneyIcon name={cat.icon} size={11} />
                      <span>{cat.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Virtualized Icon Grid (rows virtualized, columns follow width) */}
              <div
                ref={gridRef}
                className="bg-[var(--background)]/70 rounded-lg border border-[var(--border)]/70 h-[55vh] overflow-y-auto"
              >
                {filteredIcons.length > 0 && (
                  <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                    {rowVirtualizer.getVirtualItems().map((row) => {
                      const start = row.index * columns;
                      const items = filteredIcons.slice(start, start + columns);
                      return (
                        <div
                          key={row.key}
                          className="absolute left-0 flex"
                          style={{
                            top: 0,
                            transform: `translateY(${row.start}px)`,
                            height: cellSize,
                            paddingLeft: PAD,
                            gap: GAP,
                          }}
                        >
                          {items.map((item) => {
                            const active = selectedIcon === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelectedIcon(item.id)}
                                title={`${item.label} (${item.id})`}
                                style={{ width: cellSize, height: cellSize }}
                                className={`shrink-0 rounded-md flex items-center justify-center cursor-pointer transition-all ${
                                  active
                                    ? 'bg-sky-500/25 ring-2 ring-sky-400'
                                    : 'hover:bg-[var(--card)] opacity-80 hover:opacity-100'
                                }`}
                              >
                                <KenneyIcon name={item.id} size={28} color={active ? selectedColor : '#cbd5e1'} />
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
                {filteredIcons.length === 0 && (
                  <div className="py-8 text-center text-xs text-[var(--muted-foreground)] space-y-1">
                    <div>No icons match &ldquo;{iconSearchQuery}&rdquo;</div>
                    <button
                      type="button"
                      onClick={() => {
                        setIconSearchQuery('');
                        setSelectedCategory('all');
                      }}
                      className="text-sky-400 hover:underline cursor-pointer text-[11px]"
                    >
                      Reset filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Color Swatches */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Color Tint
                </span>
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer">
                  <span>Custom:</span>
                  <input
                    type="color"
                    value={selectedColor}
                    onChange={(e) => setSelectedColor(e.target.value)}
                    className="w-5 h-5 rounded border border-[var(--border)] bg-transparent cursor-pointer"
                  />
                </label>
              </div>
              <div className="grid grid-cols-9 gap-1.5 bg-[var(--background)]/70 p-2 rounded-lg border border-[var(--border)]/70">
                {QUICK_ACCESS_COLORS.map((hex) => {
                  const active = selectedColor.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setSelectedColor(hex)}
                      title={hex}
                      className={`h-6 rounded-md cursor-pointer flex items-center justify-center transition-transform ${
                        active ? 'ring-2 ring-white scale-110 shadow-xs' : 'hover:scale-105 opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => onClose()}
                className="h-8 px-4 rounded-md bg-[var(--card)] border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center justify-center transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSave(selectedIcon, selectedColor)}
                className="h-8 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium hover:opacity-90 cursor-pointer flex items-center justify-center transition-colors"
              >
                {saveLabel}
              </button>
            </div>
          </div>
    </div>
  );
};

