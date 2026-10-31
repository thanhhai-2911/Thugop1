/**
 * Các hàm tiện ích định dạng tiền, ngày tháng, nén ảnh và sao chép
 */

export function formatVND(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) return '0đ';
  const isNegative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${isNegative ? '-' : ''}${formatted}đ`;
}

export function formatVNDPositivePrefix(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined || amount === 0) return '0đ';
  if (amount > 0) return `+${formatVND(amount)}`;
  return formatVND(amount);
}

export function parseMoneyInput(raw: string): number {
  if (!raw) return 0;
  const clean = raw.trim().toLowerCase();

  // Xử lý 'k' (nghìn)
  if (clean.endsWith('k')) {
    const numPart = clean.slice(0, -1).trim().replace(/\./g, '').replace(/,/g, '.');
    const val = parseFloat(numPart);
    return isNaN(val) ? 0 : Math.round(val * 1000);
  }

  // Xử lý 'tr' hoặc 'm' (triệu)
  if (clean.endsWith('tr') || clean.endsWith('m')) {
    const endSlice = clean.endsWith('tr') ? -2 : -1;
    const numPart = clean.slice(0, endSlice).trim().replace(/\./g, '').replace(/,/g, '.');
    const val = parseFloat(numPart);
    return isNaN(val) ? 0 : Math.round(val * 1000000);
  }

  // Chuỗi số thông thường có dấu chấm/phẩy phân cách
  const digitsOnly = clean.replace(/\D/g, '');
  const parsed = parseInt(digitsOnly, 10);
  return isNaN(parsed) ? 0 : parsed;
}

export function formatNumberWithDots(val: number | string): string {
  if (!val && val !== 0) return '';
  const num = typeof val === 'string' ? parseMoneyInput(val) : Math.round(val);
  if (num === 0) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatDateDisplay(isoOrDateStr: string): string {
  if (!isoOrDateStr) return '';
  // Nếu đã ở dạng YYYY-MM-DD
  const match = isoOrDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }
  try {
    const d = new Date(isoOrDateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch {
    // fallback
  }
  return isoOrDateStr;
}

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function compressImage(file: File, maxSize = 900, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context not available'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Không thể đọc ảnh'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Lỗi tải file ảnh'));
    reader.readAsDataURL(file);
  });
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}
