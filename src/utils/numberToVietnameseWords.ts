/**
 * Chuyển đổi số tiền thành chữ tiếng Việt chuẩn xác, tự nhiên.
 * Ví dụ: 50000 -> "Năm mươi nghìn đồng"
 *       1250000 -> "Một triệu hai trăm năm mươi nghìn đồng"
 */

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readGroupOfThree(group: number, showZeroHundred: boolean): string {
  const hundreds = Math.floor(group / 100);
  const tens = Math.floor((group % 100) / 10);
  const units = group % 10;
  let result = '';

  if (hundreds > 0 || showZeroHundred) {
    result += `${DIGITS[hundreds]} trăm `;
    if (tens === 0 && units > 0) {
      result += 'linh ';
    }
  }

  if (tens === 1) {
    result += 'mười ';
  } else if (tens > 1) {
    result += `${DIGITS[tens]} mươi `;
  }

  if (tens > 0 && units === 1) {
    if (tens === 1) {
      result += 'một ';
    } else {
      result += 'mốt ';
    }
  } else if (tens > 0 && units === 5) {
    result += 'lăm ';
  } else if (units > 0 || (hundreds === 0 && tens === 0 && !showZeroHundred)) {
    if (tens === 0 && hundreds === 0 && showZeroHundred && units === 0) {
      // Do nothing
    } else if (units > 0) {
      result += `${DIGITS[units]} `;
    }
  }

  return result.trim();
}

export function numberToVietnameseWords(amount: number): string {
  if (isNaN(amount) || amount === 0) {
    return 'Không đồng';
  }

  const num = Math.abs(Math.round(amount));
  if (num === 0) return 'Không đồng';

  const unitsScale = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];
  const groups: number[] = [];
  let temp = num;

  while (temp > 0) {
    groups.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  let words = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    const groupVal = groups[i];
    if (groupVal > 0) {
      // Show zero hundreds if not the most significant group
      const showZero = i < groups.length - 1;
      const groupWord = readGroupOfThree(groupVal, showZero);
      const scale = unitsScale[i];
      words += `${groupWord} ${scale} `;
    }
  }

  words = words.trim();
  if (!words) return 'Không đồng';

  // Capitalize first character and append "đồng"
  words = words.charAt(0).toUpperCase() + words.slice(1) + ' đồng';
  return words.replace(/\s+/g, ' ');
}
