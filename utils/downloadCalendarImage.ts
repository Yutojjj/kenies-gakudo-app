export type CalendarImageShift = {
  name: string;
  start: string;
  end: string;
  color: string;
};

export type CalendarImageDay = {
  label: string;
  dateColor: string;
  shifts: CalendarImageShift[];
  note?: string;
};

const escapeXml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char] || char));

export const downloadCalendarImage = async (title: string, days: CalendarImageDay[], fileName: string) => {
  if (typeof document === 'undefined') return;
  const width = 794;
  const contentWidth = 900;
  const outputScale = 3;
  const rowHeights = days.map(day => Math.max(82, 58 + day.shifts.length * 34));
  const contentHeight = 34 + rowHeights.reduce((sum, value) => sum + value, 0) + 24;
  const height = 1123;
  const scale = Math.min(1, (width - 24) / contentWidth, (height - 24) / contentHeight);
  let y = 24;
  const rows = days.map((day, index) => {
    const rowHeight = rowHeights[index];
    const shiftLines = day.shifts.length > 0
      ? day.shifts.map((shift, shiftIndex) => {
          const shiftY = y + 45 + shiftIndex * 34;
          return `<rect x="235" y="${shiftY}" width="610" height="29" rx="6" fill="${shift.color}"/><text x="250" y="${shiftY + 21}" font-size="18" font-weight="700" fill="#17202A">${escapeXml(shift.name)}　${escapeXml(shift.start)}〜${escapeXml(shift.end)}</text>`;
        }).join('')
      : `<text x="250" y="${y + 67}" font-size="17" fill="#8A9698">シフトなし</text>`;
    const note = day.note ? `<text x="235" y="${y + 32}" font-size="14" font-weight="700" fill="#B34A4A">${escapeXml(day.note)}</text>` : '';
    const result = `<rect x="28" y="${y}" width="844" height="${rowHeight - 8}" rx="10" fill="#FFFFFF" stroke="#D8E1E2"/><text x="52" y="${y + 34}" font-size="22" font-weight="900" fill="${day.dateColor}">${escapeXml(day.label)}</text>${note}${shiftLines}`;
    y += rowHeight;
    return result;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#F3FAFA"/><g transform="translate(${(width - contentWidth * scale) / 2},12) scale(${scale})"><rect width="900" height="${contentHeight}" fill="#F3FAFA"/><rect x="28" y="10" width="844" height="48" rx="12" fill="#C8E9EB"/><text x="450" y="42" text-anchor="middle" font-size="27" font-weight="900" fill="#216E77">${escapeXml(title)}</text>${rows}</g></svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const sourceUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.src = sourceUrl;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('画像を作成できませんでした')); });
  const canvas = document.createElement('canvas');
  canvas.width = width * outputScale;
  canvas.height = height * outputScale;
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(sourceUrl);
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('PNGを作成できませんでした');
  const downloadUrl = URL.createObjectURL(png);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `${fileName}.png`;
  link.click();
  URL.revokeObjectURL(downloadUrl);
};

export const downloadHtmlAsPng = async (html: string, fileName: string) => {
  if (typeof document === 'undefined') return;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const styles = Array.from(parsed.querySelectorAll('style')).map(style => style.textContent || '').join('\n');
  const content = parsed.body.innerHTML;
  const width = 794;
  const height = 1123;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;background:#FFFFFF;"><style>${styles}</style>${content}</div></foreignObject></svg>`;
  const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.src = sourceUrl;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('画像を作成できませんでした')); });
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(sourceUrl);
  const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('PNGを作成できませんでした');
  const downloadUrl = URL.createObjectURL(png);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `${fileName}.png`;
  link.click();
  URL.revokeObjectURL(downloadUrl);
};
