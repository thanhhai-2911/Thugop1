/**
 * Dịch vụ lưu trữ dữ liệu Sổ Thu Nộp (Thuần LocalStorage + Google Sheets GAS)
 * Đã loại bỏ hoàn toàn Firebase theo yêu cầu người dùng
 */

import { AppData, Student, Fee } from '../types.ts';
import { syncToGoogleSheetGas } from './googleSheetsService.ts';

export const INITIAL_SEED_DATA: AppData = {
  version: 1,
  passcode: '6672',
  classInfo: {
    className: '',
    teacherName: '',
    note: ''
  },
  students: [
    { id: 'hs_1', name: 'Nguyễn Văn An', order: 1 },
    { id: 'hs_2', name: 'Trần Thị Bình', order: 2 },
    { id: 'hs_3', name: 'Lê Hoàng Cường', order: 3 },
    { id: 'hs_4', name: 'Phạm Thu Dung', order: 4 },
    { id: 'hs_5', name: 'Vũ Minh Đức', order: 5 }
  ],
  fees: [
    {
      id: 'fee_1',
      name: 'Quỹ lớp tháng 9',
      amount: 50000,
      exemptStudentIds: [],
      createdAt: new Date().toISOString()
    },
    {
      id: 'fee_2',
      name: 'Bảo hiểm',
      amount: 50000,
      exemptStudentIds: [],
      createdAt: new Date().toISOString()
    }
  ],
  payments: [],
  cashbook: [],
  updatedAt: new Date().toISOString()
};

const STORAGE_KEY = 'so_thu_nop_data_v2';
const INITIALIZED_FLAG = 'so_thu_nop_initialized_flag';

// Đọc dữ liệu từ bộ nhớ máy
export function loadAppData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          version: parsed.version || 1,
          passcode: parsed.passcode || '6672',
          classInfo: {
            className: parsed.classInfo?.className || '',
            teacherName: parsed.classInfo?.teacherName || '',
            note: parsed.classInfo?.note || ''
          },
          // QUAN TRỌNG: Nếu là mảng rỗng [] thì giữ nguyên mảng rỗng, KHÔNG nạp lại dữ liệu mẫu!
          students: Array.isArray(parsed.students) ? parsed.students : [],
          fees: Array.isArray(parsed.fees) ? parsed.fees : [],
          payments: Array.isArray(parsed.payments) ? parsed.payments : [],
          cashbook: Array.isArray(parsed.cashbook) ? parsed.cashbook : [],
          updatedAt: parsed.updatedAt || new Date().toISOString()
        };
      }
    }
  } catch (err) {
    console.error('Lỗi đọc dữ liệu từ máy:', err);
  }

  // Nếu là lần đầu tiên mở app trên thiết bị này và chưa từng khởi tạo
  const hasInitialized = localStorage.getItem(INITIALIZED_FLAG);
  if (!hasInitialized) {
    localStorage.setItem(INITIALIZED_FLAG, '1');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SEED_DATA));
    return { ...INITIAL_SEED_DATA };
  }

  // Nếu đã khởi tạo nhưng không có dữ liệu, trả về đối tượng rỗng
  return {
    version: 1,
    passcode: '6672',
    classInfo: { className: '', teacherName: '', note: '' },
    students: [],
    fees: [],
    payments: [],
    cashbook: [],
    updatedAt: new Date().toISOString()
  };
}

// Lưu dữ liệu vào máy & tự động đồng bộ GAS nếu có bật
export async function saveAppData(data: AppData): Promise<void> {
  const updatedData: AppData = {
    ...data,
    updatedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedData));
    localStorage.setItem(INITIALIZED_FLAG, '1');
  } catch (err) {
    console.error('Lỗi lưu vào localStorage:', err);
  }

  // Tự động đẩy lên Google Sheet qua Apps Script Web App nếu có cấu hình
  try {
    const gasUrl = localStorage.getItem('gas_webapp_url');
    const autoSync = localStorage.getItem('gas_auto_sync') === '1';
    if (gasUrl && autoSync) {
      syncToGoogleSheetGas(gasUrl, updatedData).then((res) => {
        if (res.success) {
          const timeStr =
            new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');
          localStorage.setItem('gas_last_sync', timeStr);
        }
      }).catch(() => {});
    }
  } catch {
    // Không chặn luồng
  }
}

// Xoá dữ liệu mẫu ban đầu (An, Bình, Cường, Dung, Đức & Quỹ tháng 9, Bảo hiểm)
export function removeSampleDataFrom(currentData: AppData): AppData {
  const sampleNames = ['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Hoàng Cường', 'Phạm Thu Dung', 'Vũ Minh Đức'];
  const sampleIds = ['hs_1', 'hs_2', 'hs_3', 'hs_4', 'hs_5', 's1', 's2', 's3', 's4', 's5'];
  const sampleFeeNames = ['Quỹ lớp tháng 9', 'Bảo hiểm'];
  const sampleFeeIds = ['fee_1', 'fee_2', 'f1', 'f2'];

  const filteredStudents = currentData.students.filter(
    (s) => !sampleIds.includes(s.id) && !sampleNames.includes(s.name.trim())
  );

  const filteredFees = currentData.fees.filter(
    (f) => !sampleFeeIds.includes(f.id) && !sampleFeeNames.includes(f.name.trim())
  );

  // Xoá các payment của học sinh mẫu nếu có
  const remainingStudentIds = new Set(filteredStudents.map((s) => s.id));
  const filteredPayments = currentData.payments.filter((p) => remainingStudentIds.has(p.studentId));

  const newData: AppData = {
    ...currentData,
    students: filteredStudents,
    fees: filteredFees,
    payments: filteredPayments,
    updatedAt: new Date().toISOString()
  };

  // Lưu ngay vào localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
  localStorage.setItem(INITIALIZED_FLAG, '1');

  return newData;
}

// Xoá toàn bộ dữ liệu (làm sạch toàn bộ học sinh, khoản thu, thu chi)
export function resetAllDataFrom(currentData: AppData): AppData {
  const blankData: AppData = {
    version: 1,
    passcode: currentData.passcode || '6672',
    classInfo: { className: '', teacherName: '', note: '' },
    students: [],
    fees: [],
    payments: [],
    cashbook: [],
    updatedAt: new Date().toISOString()
  };

  // Ghi đè ngay vào localStorage
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blankData));
  localStorage.setItem(INITIALIZED_FLAG, '1');

  return blankData;
}
