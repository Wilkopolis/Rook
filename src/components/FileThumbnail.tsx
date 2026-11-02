import React, { useState } from 'react';
import { FsEntry } from '../types/fs';
import { getFileIconName } from '../utils/format';
import { KenneyIcon } from './KenneyIcon';

const THUMB_SUPPORTED_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'svg',
  'mp4',
  'mov',
  'mkv',
  'pdf',
]);

interface FileThumbnailProps {
  entry: FsEntry;
  size?: number;
  className?: string;
}

export const FileThumbnail: React.FC<FileThumbnailProps> = ({
  entry,
  size = 18,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);

  const canThumb =
    !entry.isDirectory &&
    !failed &&
    THUMB_SUPPORTED_EXTS.has(entry.extension.toLowerCase());

  if (!canThumb) {
    return <KenneyIcon name={getFileIconName(entry)} size={size} className={className} />;
  }

  const reqSize = size > 32 ? 256 : 96;
  const thumbUrl = `/api/fs/thumb?path=${encodeURIComponent(entry.path)}&size=${reqSize}&m=${Math.floor(entry.modifiedMs)}`;

  return (
    <img
      src={thumbUrl}
      alt={entry.name}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={`inline-block object-contain rounded-sm shrink-0 select-none ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
};
