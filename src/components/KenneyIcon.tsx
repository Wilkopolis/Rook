import React from 'react';
import { PHOSPHOR_SVG_INNER } from './phosphorIconsData';

interface KenneyIconProps {
  name: string;
  size?: number;
  className?: string;
  color?: string;
  alt?: string;
}

const ICON_TINTS: Record<string, string> = {
  pouch: 'text-amber-300/90',
  folder: 'text-amber-300/90',
  chess_rook: 'text-[#5fa8ff]',
  resource_iron: 'text-orange-400/90',
  file_ts: 'text-sky-400/90',
  file_tsx: 'text-sky-400/90',
  file_js: 'text-yellow-300/90',
  file_jsx: 'text-yellow-300/90',
  file_html: 'text-orange-400/90',
  file_css: 'text-blue-400/90',
  file_py: 'text-emerald-400/90',
  file_cs: 'text-violet-400/90',
  file_cpp: 'text-blue-400/90',
  file_sql: 'text-teal-400/90',
  file_csv: 'text-emerald-400/90',
  file_md: 'text-slate-300',
  file_pdf: 'text-rose-400/90',
  file_image: 'text-purple-400/90',
  film: 'text-pink-400/90',
  musicOn: 'text-cyan-400/90',
  tokens_stack: 'text-amber-400/80',
};

export const KenneyIcon: React.FC<KenneyIconProps> = ({
  name,
  size = 16,
  className = '',
  color,
  alt = '',
}) => {
  const cleanName = name.replace(/\.(png|svg)$/i, '');
  const innerSvg = PHOSPHOR_SVG_INNER[cleanName] || PHOSPHOR_SVG_INNER['card'];
  const tintClass = color ? '' : ICON_TINTS[cleanName] || '';

  if (innerSvg) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 256 256"
        width={size}
        height={size}
        fill="currentColor"
        aria-label={alt || cleanName}
        className={`inline-block shrink-0 select-none ${tintClass} ${className}`}
        style={{ width: `${size}px`, height: `${size}px`, ...(color ? { color } : {}) }}
        dangerouslySetInnerHTML={{ __html: innerSvg }}
      />
    );
  }

  return (
    <img
      src={`/icons/phosphor/${cleanName}.svg`}
      alt={alt || cleanName}
      width={size}
      height={size}
      draggable={false}
      className={`inline-block object-contain shrink-0 select-none ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
};
