import { FsEntry } from '../types/fs';
import { naturalCompare } from './naturalSort';

/** Sorted, hidden-filtered rows of a split panel. Shared by the panel view and keyboard routing so both see the same order. */
export const visibleSplitItems = (
  items: FsEntry[],
  showHiddenFiles: boolean,
  sortBy: string,
  sortAsc: boolean,
): FsEntry[] => {
  const list = showHiddenFiles ? [...items] : items.filter((f) => !f.name.startsWith('.'));
  list.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    let cmp = 0;
    if (sortBy === 'size') cmp = a.sizeBytes - b.sizeBytes;
    else if (sortBy === 'modified') cmp = a.modifiedMs - b.modifiedMs;
    else if (sortBy === 'extension')
      cmp = naturalCompare(a.extension, b.extension) || naturalCompare(a.name, b.name);
    else cmp = naturalCompare(a.name, b.name);
    return sortAsc ? cmp : -cmp;
  });
  return list;
};
