/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Wallet,
  BookOpen,
  Settings as SettingsIcon,
  ChevronLeft,
  Plus,
  Trash2,
  Edit2,
  Copy,
  Check,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Camera,
  Image as ImageIcon,
  X,
  AlertTriangle,
  RefreshCw,
  Upload,
  Download,
  ExternalLink,
  Users,
  CheckSquare,
  Square,
  Lock,
  Delete,
  FileSpreadsheet,
  Code,
  Globe,
  Smartphone,
  Share2
} from 'lucide-react';

import { AppData, Student, Fee, Payment, CashbookEntry, Screen } from './types.ts';
import {
  formatVND,
  formatVNDPositivePrefix,
  parseMoneyInput,
  formatNumberWithDots,
  formatDateDisplay,
  getTodayDateString,
  compressImage,
  copyTextToClipboard
} from './utils/formatters.ts';
import { numberToVietnameseWords } from './utils/numberToVietnameseWords.ts';
import {
  loadAppData,
  saveAppData,
  removeSampleDataFrom,
  resetAllDataFrom,
  INITIAL_SEED_DATA
} from './services/storageService.ts';
import {
  GAS_SCRIPT_CODE,
  syncToGoogleSheetGas,
  fetchFromGoogleSheetGas
} from './services/googleSheetsService.ts';

// Modal thông báo/xác nhận tự làm, chữ to, dễ đọc
interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Đồng ý',
  cancelText = 'Hủy bỏ',
  isDanger = false,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-200">
        <h3 className="text-2xl font-bold text-gray-900 mb-3">{title}</h3>
        <p className="text-lg text-gray-700 whitespace-pre-line mb-6 leading-relaxed">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[52px] px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 text-lg font-semibold rounded-xl transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 min-h-[52px] px-4 py-3 text-white text-lg font-bold rounded-xl shadow-md transition-colors ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // Dữ liệu ứng dụng đọc từ bộ nhớ máy
  const [data, setData] = useState<AppData>(() => loadAppData());
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Điều hướng màn hình
  const [currentScreen, setCurrentScreen] = useState<Screen>('HOME');
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // Trạng thái khoá passcode thiết bị
  const [isDeviceUnlocked, setIsDeviceUnlocked] = useState<boolean>(() => {
    return localStorage.getItem('device_unlocked_v1') === '1';
  });
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [pinError, setPinError] = useState<boolean>(false);

  // Passcode modal khi mở Cài đặt
  const [isSettingsAuthModalOpen, setIsSettingsAuthModalOpen] = useState<boolean>(false);
  const [settingsPin, setSettingsPin] = useState<string>('');
  const [settingsPinError, setSettingsPinError] = useState<boolean>(false);

  // Toast thông báo góc đáy
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Tính toán kích thước dữ liệu (cảnh báo > 900KB)
  const isDataSizeLarge = useMemo(() => {
    try {
      const str = JSON.stringify(data);
      return str.length > 900 * 1024;
    } catch {
      return false;
    }
  }, [data]);

  // Lưu dữ liệu với tự động cập nhật
  const handleUpdateData = async (newData: AppData, toastSuccessMsg?: string) => {
    setData(newData);
    await saveAppData(newData);
    if (toastSuccessMsg) {
      showToast(toastSuccessMsg);
    }
  };

  // ----------------------------------------------------
  // LOGIC TÍNH TOÁN TIỀN (CHUẨN XÁC THEO MỤC 9)
  // canNop = Σ amount các fee mà HS không được miễn
  // daNop = Σ amount các payment của HS
  // conLai = daNop - canNop
  // ----------------------------------------------------
  const studentFinances = useMemo(() => {
    const map = new Map<string, { canNop: number; daNop: number; conLai: number }>();

    data.students.forEach((stu) => {
      let canNop = 0;
      data.fees.forEach((fee) => {
        const isExempt = fee.exemptStudentIds?.includes(stu.id);
        if (!isExempt) {
          canNop += fee.amount || 0;
        }
      });

      let daNop = 0;
      data.payments.forEach((p) => {
        if (p.studentId === stu.id) {
          daNop += p.amount || 0;
        }
      });

      const conLai = daNop - canNop;
      map.set(stu.id, { canNop, daNop, conLai });
    });

    return map;
  }, [data.students, data.fees, data.payments]);

  // Tổng quan lớp
  const classTotals = useMemo(() => {
    let tongPhaiThu = 0;
    studentFinances.forEach((v) => {
      tongPhaiThu += v.canNop;
    });

    const tongDaThu = data.payments.reduce((acc, p) => acc + (p.amount || 0), 0);
    const tongChi = data.cashbook.reduce((acc, c) => acc + (c.amount || 0), 0);
    const dangGiu = tongDaThu - tongChi;

    // Tổng còn thu (tổng nợ của những em conLai < 0)
    let tongConThu = 0;
    studentFinances.forEach((v) => {
      if (v.conLai < 0) {
        tongConThu += Math.abs(v.conLai);
      }
    });

    return { tongPhaiThu, tongDaThu, tongConThu, tongChi, dangGiu };
  }, [studentFinances, data.payments, data.cashbook]);

  // Xử lý mở khoá thiết bị
  const handlePinInput = (num: string) => {
    if (enteredPin.length >= 4) return;
    const nextPin = enteredPin + num;
    setEnteredPin(nextPin);
    setPinError(false);

    if (nextPin.length === 4) {
      if (nextPin === data.passcode || (!data.passcode && nextPin === '6672')) {
        localStorage.setItem('device_unlocked_v1', '1');
        setIsDeviceUnlocked(true);
        setEnteredPin('');
      } else {
        setPinError(true);
        setTimeout(() => {
          setEnteredPin('');
        }, 500);
      }
    }
  };

  const handlePinBackspace = () => {
    setEnteredPin((prev) => prev.slice(0, -1));
    setPinError(false);
  };

  // Mở Settings với bảo vệ mã khoá
  const handleRequestSettings = () => {
    setSettingsPin('');
    setSettingsPinError(false);
    setIsSettingsAuthModalOpen(true);
  };

  const handleSettingsPinInput = (num: string) => {
    if (settingsPin.length >= 4) return;
    const nextPin = settingsPin + num;
    setSettingsPin(nextPin);
    setSettingsPinError(false);

    if (nextPin.length === 4) {
      if (nextPin === data.passcode || (!data.passcode && nextPin === '6672')) {
        setIsSettingsAuthModalOpen(false);
        setCurrentScreen('SETTINGS');
      } else {
        setSettingsPinError(true);
        setTimeout(() => {
          setSettingsPin('');
        }, 500);
      }
    }
  };

  // ----------------------------------------------------
  // NẾU ĐANG TẢI DỮ LIỆU BAN ĐẦU
  // ----------------------------------------------------
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-6"></div>
        <h2 className="text-2xl font-bold text-gray-800">Đang tải dữ liệu…</h2>
        <p className="text-gray-500 text-lg mt-2">Vui lòng chờ trong giây lát</p>
      </div>
    );
  }

  // ----------------------------------------------------
  // MÀN HÌNH KHOÁ PASSCODE THIẾT BỊ
  // ----------------------------------------------------
  if (!isDeviceUnlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-700 to-indigo-900 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-full max-w-sm flex flex-col items-center">
          <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-4 backdrop-blur-md">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-wider uppercase mb-1">SỔ THU NỘP</h1>
          <p className="text-blue-200 text-lg mb-8 text-center">
            {data.classInfo.className ? `Lớp ${data.classInfo.className}` : 'Quỹ lớp học đơn giản'}
          </p>

          <p className="text-xl font-medium mb-4 text-blue-100">Nhập mã khoá để mở sổ</p>

          {/* 4 chấm hiển thị mã số */}
          <div
            className={`flex justify-center gap-5 mb-8 ${pinError ? 'animate-shake' : ''}`}
          >
            {[0, 1, 2, 3].map((idx) => {
              const isFilled = enteredPin.length > idx;
              return (
                <div
                  key={idx}
                  className={`w-5 h-5 rounded-full border-2 transition-all duration-200 ${
                    isFilled ? 'bg-white border-white scale-110' : 'bg-transparent border-white/40'
                  }`}
                />
              );
            })}
          </div>

          {pinError && (
            <p className="text-red-300 font-bold text-lg mb-4 animate-shake">
              Mã sai, thử lại! (Mặc định: 6672)
            </p>
          )}

          {/* Bàn phím số to 72px */}
          <div className="grid grid-cols-3 gap-4 w-full max-w-[280px]">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => handlePinInput(digit)}
                className="h-[72px] rounded-2xl bg-white/15 hover:bg-white/25 active:bg-white/35 active:scale-95 text-3xl font-bold flex items-center justify-center transition-all shadow-md select-none"
              >
                {digit}
              </button>
            ))}
            <div className="h-[72px]"></div>
            <button
              type="button"
              onClick={() => handlePinInput('0')}
              className="h-[72px] rounded-2xl bg-white/15 hover:bg-white/25 active:bg-white/35 active:scale-95 text-3xl font-bold flex items-center justify-center transition-all shadow-md select-none"
            >
              0
            </button>
            <button
              type="button"
              onClick={handlePinBackspace}
              className="h-[72px] rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/30 active:scale-95 text-2xl flex items-center justify-center transition-all shadow-md select-none"
              title="Xoá"
            >
              <Delete className="w-8 h-8 text-white" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // GIAO DIỆN CHÍNH (CONTAINER TỐI ĐA 720px CANH GIỮA)
  // ----------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center">
      <div className="w-full max-w-[720px] min-h-screen bg-white shadow-xl flex flex-col relative pb-12">
        {/* Cảnh báo dung lượng dữ liệu quá lớn */}
        {isDataSizeLarge && (
          <div className="bg-rose-100 border-b-2 border-rose-400 px-4 py-2 text-rose-950 text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-rose-700 shrink-0" />
            <span>Dữ liệu lớn, hãy xuất sao lưu và xoá bớt ảnh cũ để tránh đầy bộ nhớ!</span>
          </div>
        )}

        {/* CÁC MÀN HÌNH CHÍNH */}
        {currentScreen === 'HOME' && (
          <HomeScreen
            data={data}
            classTotals={classTotals}
            onOpenThu={() => setCurrentScreen('SO_THU_FEES')}
            onOpenNopChi={() => setCurrentScreen('SO_NOP_CHI')}
            onOpenSettings={handleRequestSettings}
          />
        )}

        {currentScreen === 'SO_THU_FEES' && (
          <SoThuFeesScreen
            data={data}
            classTotals={classTotals}
            onBack={() => setCurrentScreen('HOME')}
            onGoToStudents={() => setCurrentScreen('SO_THU_STUDENTS')}
            onUpdateData={handleUpdateData}
          />
        )}

        {currentScreen === 'SO_THU_STUDENTS' && (
          <SoThuStudentsScreen
            data={data}
            studentFinances={studentFinances}
            classTotals={classTotals}
            onBack={() => setCurrentScreen('SO_THU_FEES')}
            onSelectStudent={(stuId) => {
              setSelectedStudentId(stuId);
              setCurrentScreen('STUDENT_DETAIL');
            }}
          />
        )}

        {currentScreen === 'STUDENT_DETAIL' && selectedStudentId && (
          <StudentDetailScreen
            studentId={selectedStudentId}
            data={data}
            studentFinance={studentFinances.get(selectedStudentId)!}
            onBack={() => setCurrentScreen('SO_THU_STUDENTS')}
            onUpdateData={handleUpdateData}
          />
        )}

        {currentScreen === 'SO_NOP_CHI' && (
          <SoNopChiScreen
            data={data}
            classTotals={classTotals}
            onBack={() => setCurrentScreen('HOME')}
            onUpdateData={handleUpdateData}
          />
        )}

        {currentScreen === 'SETTINGS' && (
          <SettingsScreen
            data={data}
            onBack={() => setCurrentScreen('HOME')}
            onOpenStudents={() => setCurrentScreen('SETTINGS_STUDENTS')}
            onOpenGoogleSheets={() => setCurrentScreen('SETTINGS_GOOGLE_SHEETS')}
            onOpenPublish={() => setCurrentScreen('SETTINGS_PUBLISH')}
            onUpdateData={handleUpdateData}
            onLockDevice={() => {
              localStorage.removeItem('device_unlocked_v1');
              setIsDeviceUnlocked(false);
              setEnteredPin('');
            }}
          />
        )}

        {currentScreen === 'SETTINGS_STUDENTS' && (
          <SettingsStudentsScreen
            data={data}
            onBack={() => setCurrentScreen('SETTINGS')}
            onUpdateData={handleUpdateData}
          />
        )}


        {currentScreen === 'SETTINGS_GOOGLE_SHEETS' && (
          <SettingsGoogleSheetsScreen
            data={data}
            onBack={() => setCurrentScreen('SETTINGS')}
            onUpdateData={handleUpdateData}
          />
        )}

        {currentScreen === 'SETTINGS_PUBLISH' && (
          <SettingsPublishScreen
            onBack={() => setCurrentScreen('SETTINGS')}
          />
        )}

        {/* Modal nhập Passcode khi vào Settings */}
        {isSettingsAuthModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
                <Lock className="w-7 h-7" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-1">Mã bảo vệ Cài đặt</h3>
              <p className="text-gray-600 mb-4">Vui lòng nhập mã khoá 4 số</p>

              <div
                className={`flex justify-center gap-4 mb-6 ${
                  settingsPinError ? 'animate-shake' : ''
                }`}
              >
                {[0, 1, 2, 3].map((idx) => {
                  const isFilled = settingsPin.length > idx;
                  return (
                    <div
                      key={idx}
                      className={`w-4 h-4 rounded-full border-2 transition-all ${
                        isFilled ? 'bg-blue-600 border-blue-600' : 'bg-gray-100 border-gray-400'
                      }`}
                    />
                  );
                })}
              </div>

              {settingsPinError && (
                <p className="text-red-600 font-bold mb-3">Mã sai, thử lại!</p>
              )}

              {/* Numpad */}
              <div className="grid grid-cols-3 gap-2 w-full max-w-[260px] mx-auto mb-4">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    onClick={() => handleSettingsPinInput(digit)}
                    className="h-14 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-blue-100 text-2xl font-bold flex items-center justify-center transition-all select-none"
                  >
                    {digit}
                  </button>
                ))}
                <div className="h-14"></div>
                <button
                  type="button"
                  onClick={() => handleSettingsPinInput('0')}
                  className="h-14 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-blue-100 text-2xl font-bold flex items-center justify-center transition-all select-none"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsPin((prev) => prev.slice(0, -1))}
                  className="h-14 rounded-xl bg-gray-100 hover:bg-gray-200 text-xl flex items-center justify-center transition-all select-none"
                >
                  <Delete className="w-6 h-6 text-gray-700" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsSettingsAuthModalOpen(false)}
                className="w-full py-3 text-lg font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        {/* Toast thông báo nổi to đáy màn hình */}
        {toastMessage && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[90%] bg-emerald-700 text-white px-6 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-500 animate-bounce">
            <Check className="w-6 h-6 text-emerald-200 shrink-0" />
            <span className="text-lg font-bold">{toastMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 1. MÀN HÌNH TRANG CHỦ (SECTION 5)
// ============================================================================
function HomeScreen({
  data,
  classTotals,
  onOpenThu,
  onOpenNopChi,
  onOpenSettings
}: {
  data: AppData;
  classTotals: {
    tongPhaiThu: number;
    tongDaThu: number;
    tongConThu: number;
    tongChi: number;
    dangGiu: number;
  };
  onOpenThu: () => void;
  onOpenNopChi: () => void;
  onOpenSettings: () => void;
}) {
  const hasClassName = Boolean(data.classInfo.className && data.classInfo.className.trim());

  return (
    <div className="p-4 sm:p-6 flex flex-col flex-1">
      {/* Tiêu đề lớn */}
      <div className="text-center mt-2 mb-6">
        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">SỔ THU NỘP</h1>
        <div className="mt-1">
          {hasClassName ? (
            <span className="inline-block px-4 py-1.5 bg-blue-100 text-blue-900 text-2xl font-bold rounded-full">
              Lớp {data.classInfo.className}
            </span>
          ) : (
            <span className="text-xl text-gray-500 italic">Quỹ lớp học thông minh</span>
          )}
        </div>
      </div>

      {/* Hộp nhắc nhở nếu chưa đặt tên lớp */}
      {!hasClassName && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 mb-6 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-amber-600 shrink-0" />
            <div>
              <p className="text-lg font-bold text-amber-900">Chưa đặt tên lớp</p>
              <p className="text-base text-amber-800">
                Vào Cài đặt để nhập tên lớp (dùng cho tin nhắn Zalo gửi phụ huynh).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-full sm:w-auto px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-base rounded-xl shrink-0"
          >
            Vào Cài đặt ngay
          </button>
        </div>
      )}

      {/* Thẻ tóm tắt nhanh số tiền quỹ hiện tại */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white rounded-2xl p-5 mb-8 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-300 text-base font-medium">Tiền đang giữ</p>
            <p className="text-3xl sm:text-4xl font-black text-emerald-400 mt-1">
              {formatVND(classTotals.dangGiu)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-slate-300 text-base">Sĩ số</p>
            <p className="text-2xl font-bold text-white mt-1">{data.students.length} em</p>
          </div>
        </div>
      </div>

      {/* 2 NÚT KHỔNG LỒ (CAO TỐI THIỂU 120PX, CHỮ 28PX IN HOA ĐẬM, ICON 40PX) */}
      <div className="flex-1 flex flex-col sm:flex-row gap-5 mb-10">
        {/* NÚT SỔ THU (MÀU XANH DƯƠNG) */}
        <button
          type="button"
          onClick={onOpenThu}
          className="flex-1 min-h-[140px] sm:min-h-[180px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 active:scale-[0.98] rounded-3xl p-6 text-white shadow-xl flex flex-col justify-center items-center gap-3 transition-all cursor-pointer border-2 border-blue-500"
        >
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
            <Wallet className="w-10 h-10 text-white" />
          </div>
          <span className="text-[26px] sm:text-[30px] font-black uppercase tracking-wide text-center">
            SỔ THU
          </span>
          <span className="text-blue-100 text-base font-medium">Khoản thu & Thu tiền HS</span>
        </button>

        {/* NÚT SỔ NỘP / CHI (MÀU CAM) */}
        <button
          type="button"
          onClick={onOpenNopChi}
          className="flex-1 min-h-[140px] sm:min-h-[180px] bg-amber-600 hover:bg-amber-700 active:bg-amber-800 active:scale-[0.98] rounded-3xl p-6 text-white shadow-xl flex flex-col justify-center items-center gap-3 transition-all cursor-pointer border-2 border-amber-500"
        >
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
            <BookOpen className="w-10 h-10 text-white" />
          </div>
          <span className="text-[26px] sm:text-[30px] font-black uppercase tracking-wide text-center">
            SỔ NỘP / CHI
          </span>
          <span className="text-amber-100 text-base font-medium">Nộp về trường & Chi quỹ</span>
        </button>
      </div>

      {/* Nút bánh răng nhỏ góc dưới phải (48x48px, icon xám nhạt) */}
      <div className="flex justify-end pt-4">
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-12 h-12 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 rounded-full flex items-center justify-center transition-colors shadow-sm"
          title="Cài đặt"
        >
          <SettingsIcon className="w-7 h-7 text-gray-600" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// 2. MÀN HÌNH SỔ THU (DANH SÁCH KHOẢN THU + CHUYỂN HỌC SINH NỘP)
// ============================================================================
function SoThuFeesScreen({
  data,
  classTotals,
  onBack,
  onGoToStudents,
  onUpdateData
}: {
  data: AppData;
  classTotals: { tongPhaiThu: number; tongDaThu: number; tongConThu: number };
  onBack: () => void;
  onGoToStudents: () => void;
  onUpdateData: (newData: AppData, msg?: string) => Promise<void>;
}) {
  const [isAddEditModalOpen, setIsAddEditModalOpen] = useState<boolean>(false);
  const [editingFee, setEditingFee] = useState<Fee | null>(null);

  // Trạng thái form khoản thu
  const [feeName, setFeeName] = useState<string>('');
  const [feeAmountStr, setFeeAmountStr] = useState<string>('');
  const [exemptStudentIds, setExemptStudentIds] = useState<string[]>([]);
  const [isExemptPickerOpen, setIsExemptPickerOpen] = useState<boolean>(false);
  const [exemptSearch, setExemptSearch] = useState<string>('');

  // Modal xác nhận xoá
  const [deleteConfirmFee, setDeleteConfirmFee] = useState<Fee | null>(null);

  // Chống double tap
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const numericAmount = parseMoneyInput(feeAmountStr);

  const handleOpenAdd = () => {
    setEditingFee(null);
    setFeeName('');
    setFeeAmountStr('');
    setExemptStudentIds([]);
    setIsAddEditModalOpen(true);
  };

  const handleOpenEdit = (fee: Fee) => {
    setEditingFee(fee);
    setFeeName(fee.name);
    setFeeAmountStr(fee.amount.toString());
    setExemptStudentIds(fee.exemptStudentIds || []);
    setIsAddEditModalOpen(true);
  };

  const handleSaveFee = async () => {
    if (isSubmitting) return;
    if (!feeName.trim()) {
      alert('Vui lòng nhập tên khoản thu');
      return;
    }
    if (numericAmount <= 0) {
      alert('Vui lòng nhập số tiền lớn hơn 0');
      return;
    }

    setIsSubmitting(true);

    let updatedFees: Fee[];
    if (editingFee) {
      updatedFees = data.fees.map((f) =>
        f.id === editingFee.id
          ? {
              ...f,
              name: feeName.trim(),
              amount: numericAmount,
              exemptStudentIds: exemptStudentIds
            }
          : f
      );
    } else {
      const newFee: Fee = {
        id: crypto.randomUUID ? crypto.randomUUID() : `f_${Date.now()}`,
        name: feeName.trim(),
        amount: numericAmount,
        exemptStudentIds: exemptStudentIds,
        createdAt: new Date().toISOString()
      };
      updatedFees = [...data.fees, newFee];
    }

    await onUpdateData(
      { ...data, fees: updatedFees },
      editingFee ? 'Đã cập nhật khoản thu' : 'Đã thêm khoản thu mới'
    );

    setIsAddEditModalOpen(false);
    setTimeout(() => setIsSubmitting(false), 800);
  };

  const handleDeleteFee = async () => {
    if (!deleteConfirmFee) return;
    const updatedFees = data.fees.filter((f) => f.id !== deleteConfirmFee.id);
    await onUpdateData({ ...data, fees: updatedFees }, `Đã xoá khoản "${deleteConfirmFee.name}"`);
    setDeleteConfirmFee(null);
    setIsAddEditModalOpen(false);
  };

  return (
    <div className="flex flex-col flex-1 pb-20">
      {/* Thanh trên */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Về trang chủ</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">SỔ THU</h2>
        <div className="w-12"></div>
      </div>

      {/* Khối tổng quan 3 con số: Phải thu, Đã thu, Còn thu */}
      <div className="bg-slate-50 border-b border-gray-200 p-4">
        <div className="grid grid-cols-3 gap-2 text-center bg-white p-3 rounded-2xl shadow-xs border border-gray-100">
          <div>
            <p className="text-gray-500 text-sm font-semibold">Tổng phải thu</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5">
              {formatVND(classTotals.tongPhaiThu)}
            </p>
          </div>
          <div className="border-x border-gray-200">
            <p className="text-gray-500 text-sm font-semibold">Đã thu</p>
            <p className="text-xl sm:text-2xl font-bold text-emerald-600 mt-0.5">
              {formatVND(classTotals.tongDaThu)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-sm font-semibold">Đang thu</p>
            <p className="text-xl sm:text-2xl font-bold text-red-600 mt-0.5">
              {formatVND(classTotals.tongConThu)}
            </p>
          </div>
        </div>

        {/* 2 Nút lớn: Danh sách khoản thu & Học sinh nộp */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <button
            type="button"
            className="py-3 px-4 bg-blue-600 text-white rounded-xl font-bold text-lg shadow-sm flex items-center justify-center gap-2"
          >
            <span>DANH SÁCH KHOẢN</span>
          </button>
          <button
            type="button"
            onClick={onGoToStudents}
            className="py-3 px-4 bg-orange-600 hover:bg-orange-800 text-white border-2 border-blue-600 rounded-xl font-bold text-xl shadow-sm flex items-center justify-center gap-2"
          >
            <span>HỌC SINH NỘP →</span>
          </button>
        </div>
      </div>

      {/* Danh sách các khoản thu */}
      <div className="p-4 flex-1">
        {data.fees.length === 0 ? (
          <div className="text-center py-12 px-4 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-300">
            <p className="text-xl font-bold text-gray-700 mb-2">Chưa có khoản thu nào</p>
            <p className="text-gray-500 text-base mb-6">
              Bấm nút bên dưới để thêm khoản thu cho lớp (ví dụ: Quỹ lớp tháng 9, Bảo hiểm...)
            </p>
            <button
              type="button"
              onClick={handleOpenAdd}
              className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl shadow-md inline-flex items-center gap-2"
            >
              <Plus className="w-6 h-6" />
              <span>Thêm khoản thu đầu tiên</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {data.fees.map((fee) => {
              const exemptCount = fee.exemptStudentIds?.length || 0;
              return (
                <div
                  key={fee.id}
                  onClick={() => handleOpenEdit(fee)}
                  className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs hover:border-blue-400 active:bg-blue-50/50 transition-all cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="flex-1">
                    <p className="text-xl font-bold text-gray-900 leading-tight">{fee.name}</p>
                    <p className="text-gray-500 text-base mt-1">
                      {exemptCount > 0 ? (
                        <span className="text-amber-700 font-semibold bg-amber-50 px-2 py-0.5 rounded-md">
                          Miễn: {exemptCount} HS
                        </span>
                      ) : (
                        <span>Áp dụng tất cả HS</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-blue-700">{formatVND(fee.amount)}</p>
                    <span className="text-sm font-semibold text-gray-400">Chạm để sửa</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Nút + THÊM KHOẢN THU dính đáy */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center p-3 bg-white/95 backdrop-blur-xs border-t border-gray-200 z-30">
        <div className="w-full max-w-[720px]">
          <button
            type="button"
            onClick={handleOpenAdd}
            className="w-full min-h-[58px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xl font-black rounded-2xl shadow-lg flex items-center justify-center gap-2"
          >
            <Plus className="w-7 h-7" />
            <span>+ THÊM KHOẢN THU</span>
          </button>
        </div>
      </div>

      {/* Modal Thêm / Sửa khoản thu toàn màn hình */}
      {isAddEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header modal */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-2xl font-bold text-gray-900">
                {editingFee ? 'Sửa khoản thu' : 'Thêm khoản thu mới'}
              </h3>
              <button
                type="button"
                onClick={() => setIsAddEditModalOpen(false)}
                className="w-10 h-10 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Nội dung form */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              <div>
                <label className="block text-lg font-bold text-gray-800 mb-1">Tên khoản thu</label>
                <input
                  type="text"
                  value={feeName}
                  onChange={(e) => setFeeName(e.target.value)}
                  placeholder="VD: Quỹ lớp tháng 9, Tiền áo đồng phục..."
                  className="w-full min-h-[52px] text-xl px-4 py-2 border-2 border-gray-300 focus:border-blue-600 rounded-xl outline-hidden font-medium"
                />
              </div>

              <div>
                <label className="block text-lg font-bold text-gray-800 mb-1">
                  Số tiền thu (VNĐ)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberWithDots(feeAmountStr)}
                  onChange={(e) => setFeeAmountStr(e.target.value)}
                  placeholder="VD: 50.000 hoặc 50k"
                  className="w-full min-h-[56px] text-2xl font-black px-4 py-2 border-2 border-gray-300 focus:border-blue-600 rounded-xl outline-hidden text-blue-700"
                />
                <p className="text-base text-gray-600 italic mt-1 font-medium bg-gray-50 p-2 rounded-lg border border-gray-200">
                  = {numberToVietnameseWords(numericAmount)}
                </p>
              </div>

              {/* Nút mở danh sách học sinh được miễn */}
              <div>
                <label className="block text-lg font-bold text-gray-800 mb-1">
                  Học sinh được miễn
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setExemptSearch('');
                    setIsExemptPickerOpen(true);
                  }}
                  className="w-full min-h-[52px] px-4 py-3 bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 rounded-xl text-amber-900 font-bold text-lg flex items-center justify-between"
                >
                  <span>NHẬP HỌC SINH ĐƯỢC MIỄN</span>
                  <span className="bg-amber-200 px-3 py-1 rounded-lg text-base">
                    Đã chọn: {exemptStudentIds.length} HS
                  </span>
                </button>
                {exemptStudentIds.length > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    Các em được miễn sẽ không bị tính khoản tiền này vào "Cần nộp".
                  </p>
                )}
              </div>
            </div>

            {/* Chân modal */}
            <div className="p-4 border-t border-gray-200 bg-slate-50 space-y-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleSaveFee}
                className="w-full min-h-[56px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white text-xl font-bold rounded-2xl shadow-md transition-all"
              >
                LƯU KHOẢN THU
              </button>

              {editingFee && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmFee(editingFee)}
                  className="w-full py-3 text-red-600 hover:bg-red-50 font-bold text-lg rounded-xl transition-colors"
                >
                  Xoá khoản này
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal chọn học sinh được miễn */}
      {isExemptPickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-2xl font-bold text-gray-900">Chọn HS được miễn</h3>
              <button
                type="button"
                onClick={() => setIsExemptPickerOpen(false)}
                className="w-10 h-10 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Ô tìm kiếm & nút thao tác nhanh */}
            <div className="p-3 border-b border-gray-200 bg-white space-y-2">
              <div className="relative">
                <Search className="w-6 h-6 text-gray-400 absolute left-3 top-3.5" />
                <input
                  type="text"
                  value={exemptSearch}
                  onChange={(e) => setExemptSearch(e.target.value)}
                  placeholder="Tìm tên học sinh..."
                  className="w-full pl-11 pr-4 py-3 text-lg border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600"
                />
              </div>
              <div className="flex items-center justify-between text-base font-medium px-1">
                <span className="text-blue-700 font-bold">
                  Đã chọn {exemptStudentIds.length} học sinh được miễn
                </span>
                {exemptStudentIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExemptStudentIds([])}
                    className="text-red-600 hover:underline font-bold"
                  >
                    Bỏ chọn tất cả
                  </button>
                )}
              </div>
            </div>

            {/* Danh sách học sinh với CHECKBOX TO (28px), chạm cả hàng */}
            <div className="flex-1 overflow-y-auto p-3 divide-y divide-gray-100">
              {data.students
                .filter((s) => s.name.toLowerCase().includes(exemptSearch.toLowerCase()))
                .map((student) => {
                  const isChecked = exemptStudentIds.includes(student.id);
                  return (
                    <div
                      key={student.id}
                      onClick={() => {
                        if (isChecked) {
                          setExemptStudentIds(exemptStudentIds.filter((id) => id !== student.id));
                        } else {
                          setExemptStudentIds([...exemptStudentIds, student.id]);
                        }
                      }}
                      className={`min-h-[64px] px-3 py-3 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        isChecked ? 'bg-amber-100/80 font-bold' : 'hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-xl text-gray-900">{student.name}</span>
                      <div className="shrink-0">
                        {isChecked ? (
                          <CheckSquare className="w-7 h-7 text-amber-600" />
                        ) : (
                          <Square className="w-7 h-7 text-gray-400" />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="p-4 border-t border-gray-200 bg-slate-50">
              <button
                type="button"
                onClick={() => setIsExemptPickerOpen(false)}
                className="w-full min-h-[52px] bg-blue-600 hover:bg-blue-700 text-white font-bold text-xl rounded-xl shadow-md"
              >
                XONG ({exemptStudentIds.length} em)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận xoá khoản thu */}
      <ConfirmModal
        isOpen={Boolean(deleteConfirmFee)}
        title="Xác nhận xoá khoản thu"
        message={`Bạn có chắc chắn muốn xoá khoản "${deleteConfirmFee?.name}"?\n(Số tiền ${formatVND(
          deleteConfirmFee?.amount || 0
        )})`}
        confirmText="Xoá khoản này"
        isDanger={true}
        onConfirm={handleDeleteFee}
        onCancel={() => setDeleteConfirmFee(null)}
      />
    </div>
  );
}

// ============================================================================
// 3. MÀN HÌNH DANH SÁCH HỌC SINH NỘP (SECTION 6.3)
// ============================================================================
function SoThuStudentsScreen({
  data,
  studentFinances,
  classTotals,
  onBack,
  onSelectStudent
}: {
  data: AppData;
  studentFinances: Map<string, { canNop: number; daNop: number; conLai: number }>;
  classTotals: { tongPhaiThu: number; tongDaThu: number; tongConThu: number };
  onBack: () => void;
  onSelectStudent: (id: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortByDebtFirst, setSortByDebtFirst] = useState<boolean>(false);

  // Sắp xếp và tìm kiếm
  const filteredStudents = useMemo(() => {
    let list = [...data.students];

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }

    if (sortByDebtFirst) {
      // Còn nợ trước (conLai < 0 xếp trước, theo mức độ nợ giảm dần)
      list.sort((a, b) => {
        const finA = studentFinances.get(a.id)?.conLai || 0;
        const finB = studentFinances.get(b.id)?.conLai || 0;
        return finA - finB;
      });
    } else {
      // Thứ tự lớp
      list.sort((a, b) => a.order - b.order);
    }

    return list;
  }, [data.students, searchTerm, sortByDebtFirst, studentFinances]);

  return (
    <div className="flex flex-col flex-1 pb-10">
      {/* Thanh trên */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>DS Khoản</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">HỌC SINH NỘP</h2>
        <div className="w-12"></div>
      </div>

      {/* Khối tổng quan 3 con số */}
      <div className="bg-slate-50 border-b border-gray-200 p-4">
        <div className="grid grid-cols-3 gap-2 text-center bg-white p-3 rounded-2xl shadow-xs border border-gray-100 mb-3">
          <div>
            <p className="text-gray-500 text-sm font-semibold">Phải thu</p>
            <p className="text-xl font-bold text-gray-900 mt-0.5">
              {formatVND(classTotals.tongPhaiThu)}
            </p>
          </div>
          <div className="border-x border-gray-200">
            <p className="text-gray-500 text-sm font-semibold">Đã thu</p>
            <p className="text-xl font-bold text-emerald-600 mt-0.5">
              {formatVND(classTotals.tongDaThu)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-sm font-semibold">Đang thu</p>
            <p className="text-xl font-bold text-red-600 mt-0.5">
              {formatVND(classTotals.tongConThu)}
            </p>
          </div>
        </div>

        {/* Ô tìm kiếm chữ to */}
        <div className="relative mb-3">
          <Search className="w-6 h-6 text-gray-400 absolute left-3.5 top-3.5" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm tên học sinh trong lớp..."
            className="w-full pl-12 pr-4 min-h-[52px] text-lg border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600 bg-white"
          />
        </div>

        {/* Nút gạt sắp xếp */}
        <button
          type="button"
          onClick={() => setSortByDebtFirst((prev) => !prev)}
          className="w-full min-h-[48px] px-4 py-2.5 bg-white border-2 border-gray-300 rounded-xl flex items-center justify-between text-base font-bold text-gray-800 shadow-xs"
        >
          <span className="flex items-center gap-2">
            <ArrowUpDown className="w-5 h-5 text-blue-600" />
            <span>Sắp xếp:</span>
          </span>
          <span className="text-blue-700 bg-blue-50 px-3 py-1 rounded-lg">
            {sortByDebtFirst ? '🔴 Còn nợ trước' : '📋 Theo thứ tự lớp'}
          </span>
        </button>
      </div>

      {/* Danh sách học sinh: mỗi HS 1 hàng cao (min 72px), chạm cả hàng */}
      <div className="p-3 flex-1 space-y-2.5">
        {filteredStudents.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-xl font-bold">Không tìm thấy học sinh nào</p>
          </div>
        ) : (
          filteredStudents.map((student) => {
            const fin = studentFinances.get(student.id) || { canNop: 0, daNop: 0, conLai: 0 };
            const isDebt = fin.conLai < 0;
            const isZero = fin.conLai === 0;
            const isSurplus = fin.conLai > 0;

            return (
              <div
                key={student.id}
                onClick={() => onSelectStudent(student.id)}
                className={`min-h-[76px] p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 shadow-xs ${
                  isDebt
                    ? 'bg-red-50/80 border-red-200 hover:border-red-400'
                    : 'bg-white border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="flex-1">
                  <p className="text-[22px] font-bold text-gray-900 leading-tight">
                    {student.name}
                  </p>
                  <p className="text-sm font-medium text-gray-500 mt-1">
                    Cần: {formatVND(fin.canNop)} • Đã nộp: {formatVND(fin.daNop)}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  {isDebt && (
                    <span className="text-[22px] font-black text-[#dc2626]">
                      {formatVND(fin.conLai)}
                    </span>
                  )}
                  {isZero && (
                    <span className="text-[22px] font-black text-[#6b7280]">0đ</span>
                  )}
                  {isSurplus && (
                    <span className="text-[22px] font-black text-[#2563eb]">
                      {formatVNDPositivePrefix(fin.conLai)}
                    </span>
                  )}
                  <p className="text-xs font-semibold text-gray-400">Chạm để thu tiền</p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 4. MÀN HÌNH CHI TIẾT HỌC SINH (SECTION 6.4)
// ============================================================================
function StudentDetailScreen({
  studentId,
  data,
  studentFinance,
  onBack,
  onUpdateData
}: {
  studentId: string;
  data: AppData;
  studentFinance: { canNop: number; daNop: number; conLai: number };
  onBack: () => void;
  onUpdateData: (newData: AppData, msg?: string) => Promise<void>;
}) {
  const student = data.students.find((s) => s.id === studentId);
  const studentPayments = useMemo(() => {
    return data.payments
      .filter((p) => p.studentId === studentId)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data.payments, studentId]);

  // Ô nhập tiền
  const [payAmountStr, setPayAmountStr] = useState<string>('');
  const [payDate, setPayDate] = useState<string>(getTodayDateString());
  const [payNote, setPayNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Copy Zalo toast
  const [isCopiedZalo, setIsCopiedZalo] = useState<boolean>(false);

  // Modal xác nhận xoá khoản thanh toán
  const [deletePaymentConfirm, setDeletePaymentConfirm] = useState<Payment | null>(null);

  // Modal sửa khoản thanh toán
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [editPayAmountStr, setEditPayAmountStr] = useState<string>('');
  const [editPayDate, setEditPayDate] = useState<string>('');

  if (!student) {
    return (
      <div className="p-6 text-center">
        <p className="text-xl font-bold text-gray-700">Không tìm thấy thông tin học sinh</p>
        <button onClick={onBack} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-xl">
          Quay lại
        </button>
      </div>
    );
  }

  const numericPayAmount = parseMoneyInput(payAmountStr);

  // Nộp đủ số tiền còn lại (nếu conLai < 0)
  const remainingDebt = studentFinance.conLai < 0 ? Math.abs(studentFinance.conLai) : 0;

  // Ghi nhận tiền nộp
  const handleRecordPayment = async () => {
    if (isSubmitting) return;
    if (numericPayAmount <= 0) {
      alert('Vui lòng nhập số tiền nộp lớn hơn 0');
      return;
    }

    setIsSubmitting(true);

    const newPayment: Payment = {
      id: crypto.randomUUID ? crypto.randomUUID() : `p_${Date.now()}`,
      studentId: student.id,
      amount: numericPayAmount,
      date: payDate || getTodayDateString(),
      note: payNote.trim(),
      createdAt: new Date().toISOString()
    };

    const updatedPayments = [...data.payments, newPayment];
    await onUpdateData(
      { ...data, payments: updatedPayments },
      `Đã ghi nhận ${formatVND(numericPayAmount)} cho ${student.name}`
    );

    setPayAmountStr('');
    setPayNote('');

    // Disable nút 800ms để tránh double tap
    setTimeout(() => {
      setIsSubmitting(false);
    }, 800);
  };

  // Xoá thanh toán
  const handleDeletePayment = async () => {
    if (!deletePaymentConfirm) return;
    const updatedPayments = data.payments.filter((p) => p.id !== deletePaymentConfirm.id);
    await onUpdateData(
      { ...data, payments: updatedPayments },
      `Đã xoá ${formatVND(deletePaymentConfirm.amount)}`
    );
    setDeletePaymentConfirm(null);
  };

  // Sửa thanh toán
  const handleSaveEditPayment = async () => {
    if (!editingPayment) return;
    const amount = parseMoneyInput(editPayAmountStr);
    if (amount <= 0) {
      alert('Số tiền phải lớn hơn 0');
      return;
    }

    const updatedPayments = data.payments.map((p) =>
      p.id === editingPayment.id ? { ...p, amount, date: editPayDate } : p
    );

    await onUpdateData({ ...data, payments: updatedPayments }, 'Đã cập nhật lịch sử thu');
    setEditingPayment(null);
  };

  // --------------------------------------------------------------------------
  // TIN NHẮN ZALO GỬI PHỤ HUYNH (MẪU CHÍNH XÁC THEO MỤC 6.4)
  // SỔ THU {classInfo.className}
  // Học sinh: {tên HS}
  // {DÒNG TRẠNG THÁI}
  // --- Danh mục các khoản ---
  // - {tên khoản 1}: {số tiền}đ{ " (miễn)" nếu HS được miễn}
  // - {tên khoản 2}: {số tiền}đ
  // --- Lịch sử thu nộp ---
  // {dd/mm/yyyy} ---- {số tiền}đ
  // --------------------------------------------------------------------------
  const zaloMessage = useMemo(() => {
    let statusLine = '';
    if (studentFinance.conLai < 0) {
      statusLine = `Còn thiếu: ${formatVND(Math.abs(studentFinance.conLai))}`;
    } else if (studentFinance.conLai === 0) {
      statusLine = 'Đã nộp đủ';
    } else {
      statusLine = `Nộp dư: ${formatVND(studentFinance.conLai)}`;
    }

    let feesLines = '';
    data.fees.forEach((f) => {
      const isExempt = f.exemptStudentIds?.includes(student.id);
      feesLines += `- ${f.name}: ${formatVND(f.amount)}${isExempt ? ' (miễn)' : ''}\n`;
    });
    if (!feesLines) feesLines = '(Chưa có danh mục khoản thu)\n';

    let historyLines = '';
    if (studentPayments.length === 0) {
      historyLines = 'Chưa có lần nộp nào';
    } else {
      // Sắp xếp theo ngày tăng dần để gửi phụ huynh rõ ràng
      const sorted = [...studentPayments].sort((a, b) => a.date.localeCompare(b.date));
      historyLines = sorted
        .map((p) => `${formatDateDisplay(p.date)} ---- ${formatVND(p.amount)}`)
        .join('\n');
    }

    return `SỔ THU ${data.classInfo.className || ''}
Học sinh: ${student.name}
${statusLine}
--- Danh mục các khoản ---
${feesLines.trim()}
--- Lịch sử thu nộp ---
${historyLines}`;
  }, [data.classInfo.className, student.name, studentFinance, data.fees, studentPayments]);

  const handleCopyZalo = async () => {
    const ok = await copyTextToClipboard(zaloMessage);
    if (ok) {
      setIsCopiedZalo(true);
      setTimeout(() => setIsCopiedZalo(false), 2000);
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-16">
      {/* Header: ← + tên HS (24px đậm) */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Danh sách</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900 truncate max-w-[240px] sm:max-w-none">
          {student.name}
        </h2>
        <div className="w-12"></div>
      </div>

      <div className="p-4 space-y-5">
        {/* 3 ô số liệu ngang: Cần nộp | Đã nộp | Còn lại */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-slate-50 border border-gray-200 p-3 rounded-2xl">
            <p className="text-gray-500 text-sm font-semibold">Cần nộp</p>
            <p className="text-xl sm:text-2xl font-bold text-gray-900 mt-1">
              {formatVND(studentFinance.canNop)}
            </p>
          </div>
          <div className="bg-slate-50 border border-gray-200 p-3 rounded-2xl">
            <p className="text-gray-500 text-sm font-semibold">Đã nộp</p>
            <p className="text-xl sm:text-2xl font-bold text-emerald-600 mt-1">
              {formatVND(studentFinance.daNop)}
            </p>
          </div>
          <div
            className={`border p-3 rounded-2xl ${
              studentFinance.conLai < 0
                ? 'bg-red-50 border-red-300 text-red-600'
                : studentFinance.conLai === 0
                ? 'bg-gray-50 border-gray-300 text-gray-700'
                : 'bg-blue-50 border-blue-300 text-blue-600'
            }`}
          >
            <p className="text-sm font-semibold">Còn lại</p>
            <p className="text-xl sm:text-2xl font-black mt-1">
              {studentFinance.conLai > 0
                ? formatVNDPositivePrefix(studentFinance.conLai)
                : formatVND(studentFinance.conLai)}
            </p>
          </div>
        </div>

        {/* Danh sách khoản thu áp dụng cho HS này */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs">
          <h3 className="text-lg font-bold text-gray-900 mb-2">Các khoản thu của lớp</h3>
          {data.fees.length === 0 ? (
            <p className="text-gray-500 text-base">Chưa có khoản thu nào</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.fees.map((fee) => {
                const isExempt = fee.exemptStudentIds?.includes(student.id);
                return (
                  <div key={fee.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span
                        className={`text-lg font-semibold ${
                          isExempt ? 'line-through text-gray-400' : 'text-gray-800'
                        }`}
                      >
                        {fee.name}
                      </span>
                      {isExempt && (
                        <span className="ml-2 text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                          Được miễn
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-lg font-bold ${
                        isExempt ? 'text-gray-400 line-through' : 'text-blue-700'
                      }`}
                    >
                      {formatVND(fee.amount)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* KHU NHẬP TIỀN (NỔI BẬT NHẤT) */}
        <div className="bg-blue-50/80 border-2 border-blue-300 rounded-3xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xl font-black text-blue-950">Số tiền nộp lần này</label>
            <input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              className="px-3 py-1 bg-white border border-blue-200 rounded-lg text-base font-bold text-gray-700"
            />
          </div>

          {/* Input cực to (cao 64px, 28px, inputMode numeric), tự format dấu chấm */}
          <div>
            <input
              type="text"
              inputMode="numeric"
              value={formatNumberWithDots(payAmountStr)}
              onChange={(e) => setPayAmountStr(e.target.value)}
              placeholder="0"
              className="w-full h-16 text-3xl font-black px-4 bg-white border-2 border-blue-400 focus:border-blue-600 rounded-2xl outline-hidden text-blue-900 text-center shadow-inner"
            />
            {numericPayAmount > 0 && (
              <p className="text-base text-blue-900 italic mt-1 font-semibold text-center">
                = {numberToVietnameseWords(numericPayAmount)}
              </p>
            )}
          </div>

          {/* 2 nút gợi ý nhanh: Nộp đủ còn lại & Xoá */}
          <div className="flex gap-2">
            {remainingDebt > 0 ? (
              <button
                type="button"
                onClick={() => setPayAmountStr(remainingDebt.toString())}
                className="flex-1 py-3 px-3 bg-white hover:bg-blue-100 border border-blue-300 rounded-xl text-blue-800 font-bold text-base shadow-xs"
              >
                Nộp đủ còn lại ({formatVND(remainingDebt)})
              </button>
            ) : (
              <div className="flex-1 text-center py-2 text-sm text-emerald-800 font-semibold bg-emerald-50 rounded-xl">
                ✓ Đã nộp đủ tiền các khoản
              </div>
            )}
            <button
              type="button"
              onClick={() => setPayAmountStr('')}
              className="px-5 py-3 bg-white hover:bg-red-50 border border-gray-300 rounded-xl text-gray-700 font-bold text-base shadow-xs"
            >
              Xoá
            </button>
          </div>

          {/* NÚT GHI NHẬN: TOÀN CHIỀU RỘNG, CAO 64PX, 22PX IN HOA, XANH LÁ */}
          <button
            type="button"
            disabled={isSubmitting || numericPayAmount <= 0}
            onClick={handleRecordPayment}
            className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white text-[22px] font-black uppercase rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="w-8 h-8" />
            <span>GHI NHẬN</span>
          </button>
        </div>

        {/* LỊCH SỬ THU NỘP CỦA HỌC SINH */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs">
          <h3 className="text-xl font-bold text-gray-900 mb-3">Lịch sử thu nộp</h3>
          {studentPayments.length === 0 ? (
            <p className="text-gray-500 text-base italic py-2">Chưa có lần nộp nào</p>
          ) : (
            <div className="space-y-2">
              {studentPayments.map((p) => (
                <div
                  key={p.id}
                  className="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="text-lg font-bold text-gray-900">
                      Ngày {formatDateDisplay(p.date)} —{' '}
                      <span className="text-emerald-700">{formatVND(p.amount)}</span>
                    </p>
                    {p.note && <p className="text-sm text-gray-500 mt-0.5">{p.note}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPayment(p);
                        setEditPayAmountStr(p.amount.toString());
                        setEditPayDate(p.date);
                      }}
                      className="p-2 hover:bg-blue-100 rounded-lg text-blue-600"
                      title="Sửa"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletePaymentConfirm(p)}
                      className="p-2 hover:bg-red-100 rounded-lg text-red-600"
                      title="Xoá"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* BOX TIN NHẮN ZALO (BẮT BUỘC) */}
        <div className="bg-sky-50 border-2 border-sky-300 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-sky-950">Tin nhắn gửi phụ huynh</h3>
            <button
              type="button"
              onClick={handleCopyZalo}
              className={`min-h-[44px] px-4 py-2 rounded-xl font-bold text-base flex items-center gap-2 transition-all ${
                isCopiedZalo
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-700 text-white shadow-xs'
              }`}
            >
              {isCopiedZalo ? (
                <>
                  <Check className="w-5 h-5" />
                  <span>Đã copy!</span>
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5" />
                  <span>COPY</span>
                </>
              )}
            </button>
          </div>
          <div className="bg-white p-3 rounded-xl border border-sky-200 text-[15px] font-mono whitespace-pre-line text-gray-800 select-all leading-relaxed">
            {zaloMessage}
          </div>
        </div>
      </div>

      {/* Modal xác nhận xoá lần thanh toán */}
      <ConfirmModal
        isOpen={Boolean(deletePaymentConfirm)}
        title="Xác nhận xoá lịch sử nộp"
        message={`Xoá ${formatVND(deletePaymentConfirm?.amount || 0)} ngày ${formatDateDisplay(
          deletePaymentConfirm?.date || ''
        )} của ${student.name}?`}
        confirmText="Xoá"
        isDanger={true}
        onConfirm={handleDeletePayment}
        onCancel={() => setDeletePaymentConfirm(null)}
      />

      {/* Modal sửa lần thanh toán */}
      {editingPayment && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-3">Sửa lần nộp tiền</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Ngày nộp</label>
                <input
                  type="date"
                  value={editPayDate}
                  onChange={(e) => setEditPayDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Số tiền</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberWithDots(editPayAmountStr)}
                  onChange={(e) => setEditPayAmountStr(e.target.value)}
                  className="w-full px-3 py-2 text-xl font-bold border rounded-xl"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingPayment(null)}
                className="flex-1 py-2.5 bg-gray-100 rounded-xl font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditPayment}
                className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-bold"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. MÀN HÌNH SỔ NỘP / CHI (SECTION 7)
// ============================================================================
function SoNopChiScreen({
  data,
  classTotals,
  onBack,
  onUpdateData
}: {
  data: AppData;
  classTotals: { tongDaThu: number; tongChi: number; dangGiu: number };
  onBack: () => void;
  onUpdateData: (newData: AppData, msg?: string) => Promise<void>;
}) {
  const [modalType, setModalType] = useState<'nop' | 'chi' | null>(null);
  const [editingEntry, setEditingEntry] = useState<CashbookEntry | null>(null);

  // Form states
  const [entryDate, setEntryDate] = useState<string>(getTodayDateString());
  const [entryCategory, setEntryCategory] = useState<string>('');
  const [entryAmountStr, setEntryAmountStr] = useState<string>('');
  const [entryPerson, setEntryPerson] = useState<string>('');
  const [entryNote, setEntryNote] = useState<string>('');
  const [entryReceiptData, setEntryReceiptData] = useState<string>('');
  const [isCompressingImage, setIsCompressingImage] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Modal xem ảnh chứng từ lớn
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Modal xác nhận xoá
  const [deleteConfirmEntry, setDeleteConfirmEntry] = useState<CashbookEntry | null>(null);

  // Copy Zalo Quỹ
  const [isCopiedZalo, setIsCopiedZalo] = useState<boolean>(false);

  const numericAmount = parseMoneyInput(entryAmountStr);

  const handleOpenAdd = (type: 'nop' | 'chi') => {
    setEditingEntry(null);
    setModalType(type);
    setEntryDate(getTodayDateString());
    setEntryCategory('');
    setEntryAmountStr('');
    setEntryPerson('');
    setEntryNote('');
    setEntryReceiptData('');
  };

  const handleOpenEdit = (entry: CashbookEntry) => {
    setEditingEntry(entry);
    setModalType(entry.type);
    setEntryDate(entry.date);
    setEntryCategory(entry.category);
    setEntryAmountStr(entry.amount.toString());
    setEntryPerson(entry.person);
    setEntryNote(entry.note || '');
    setEntryReceiptData(entry.receiptData || '');
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsCompressingImage(true);
      const base64 = await compressImage(file, 900, 0.6);
      setEntryReceiptData(base64);
    } catch (err) {
      alert('Không thể tải ảnh. Vui lòng thử lại!');
    } finally {
      setIsCompressingImage(false);
    }
  };

  const handleSaveEntry = async () => {
    if (isSubmitting) return;
    if (!entryCategory.trim()) {
      alert(modalType === 'nop' ? 'Vui lòng nhập nộp khoản nào' : 'Vui lòng nhập chi khoản gì');
      return;
    }
    if (numericAmount <= 0) {
      alert('Vui lòng nhập số tiền lớn hơn 0');
      return;
    }
    if (!entryPerson.trim()) {
      alert(modalType === 'nop' ? 'Vui lòng nhập nộp cho ai' : 'Vui lòng nhập ai chi');
      return;
    }

    setIsSubmitting(true);

    let updatedCashbook: CashbookEntry[];
    if (editingEntry) {
      updatedCashbook = data.cashbook.map((c) =>
        c.id === editingEntry.id
          ? {
              ...c,
              type: modalType!,
              date: entryDate,
              category: entryCategory.trim(),
              amount: numericAmount,
              person: entryPerson.trim(),
              note: entryNote.trim(),
              receiptData: entryReceiptData
            }
          : c
      );
    } else {
      const newEntry: CashbookEntry = {
        id: crypto.randomUUID ? crypto.randomUUID() : `c_${Date.now()}`,
        type: modalType!,
        date: entryDate,
        category: entryCategory.trim(),
        amount: numericAmount,
        person: entryPerson.trim(),
        note: entryNote.trim(),
        receiptData: entryReceiptData,
        createdAt: new Date().toISOString()
      };
      updatedCashbook = [newEntry, ...data.cashbook];
    }

    await onUpdateData(
      { ...data, cashbook: updatedCashbook },
      modalType === 'nop' ? 'Đã ghi nhận nộp tiền' : 'Đã ghi nhận chi tiền'
    );

    setModalType(null);
    setTimeout(() => setIsSubmitting(false), 800);
  };

  const handleDeleteEntry = async () => {
    if (!deleteConfirmEntry) return;
    const updated = data.cashbook.filter((c) => c.id !== deleteConfirmEntry.id);
    await onUpdateData(
      { ...data, cashbook: updated },
      `Đã xoá bút toán ${formatVND(deleteConfirmEntry.amount)}`
    );
    setDeleteConfirmEntry(null);
    setModalType(null);
  };

  // Tin nhắn Zalo Sổ Quỹ
  const zaloCashbookMessage = useMemo(() => {
    let history = '';
    if (data.cashbook.length === 0) {
      history = 'Chưa có bút toán nào';
    } else {
      const sorted = [...data.cashbook].sort((a, b) => a.date.localeCompare(b.date));
      history = sorted
        .map((c) => {
          const typeStr = c.type === 'nop' ? 'Nộp' : 'Chi';
          const info = c.type === 'nop' ? `nộp cho ${c.person} - ${c.category}` : `${c.category} - ${c.person}`;
          return `${formatDateDisplay(c.date)} --- ${typeStr}: ${formatVND(c.amount)} (${info})`;
        })
        .join('\n');
    }

    return `SỔ QUỸ ${data.classInfo.className || ''}
Tổng thu: ${formatVND(classTotals.tongDaThu)}
Tổng chi: ${formatVND(classTotals.tongChi)}
Đang giữ: ${formatVND(classTotals.dangGiu)}
--- Lịch sử ---
${history}`;
  }, [data.classInfo.className, classTotals, data.cashbook]);

  const handleCopyCashbookZalo = async () => {
    const ok = await copyTextToClipboard(zaloCashbookMessage);
    if (ok) {
      setIsCopiedZalo(true);
      setTimeout(() => setIsCopiedZalo(false), 2000);
    }
  };

  // Gợi ý khoản mục
  const feeSuggestions = data.fees.map((f) => f.name);
  const chiSuggestions = ['Mua giấy thi', 'Mua quà 20/11', 'Photo tài liệu', 'Liên hoan trung thu', 'Nước uống HS'];

  return (
    <div className="flex flex-col flex-1 pb-16">
      {/* Header ← + SỔ NỘP / CHI */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Trang chủ</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">SỔ NỘP / CHI</h2>
        <div className="w-12"></div>
      </div>

      <div className="p-4 space-y-4">
        {/* Khối tổng quan 3 số: Tổng thu (xanh), Tổng chi (đỏ), Đang giữ (đậm, to nhất) */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <div className="grid grid-cols-2 gap-3 text-center mb-3">
            <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">
              <p className="text-gray-600 text-sm font-semibold">Tổng thu (HS nộp)</p>
              <p className="text-xl sm:text-2xl font-bold text-emerald-700 mt-0.5">
                {formatVND(classTotals.tongDaThu)}
              </p>
            </div>
            <div className="bg-red-50 border border-red-200 p-2.5 rounded-xl">
              <p className="text-gray-600 text-sm font-semibold">Tổng chi & nộp đi</p>
              <p className="text-xl sm:text-2xl font-bold text-red-700 mt-0.5">
                {formatVND(classTotals.tongChi)}
              </p>
            </div>
          </div>
          <div className="text-center pt-2 border-t border-gray-100">
            <p className="text-gray-500 text-base font-semibold">Đang giữ</p>
            <p className="text-3xl sm:text-4xl font-black text-gray-900 mt-0.5">
              {formatVND(classTotals.dangGiu)}
            </p>
          </div>
        </div>

        {/* 2 NÚT LỚN: NỘP TIỀN (cam) VÀ CHI TIỀN (đỏ) */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleOpenAdd('nop')}
            className="min-h-[72px] bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-2xl font-black text-xl shadow-md flex items-center justify-center gap-2"
          >
            <Plus className="w-7 h-7" />
            <span>NỘP TIỀN</span>
          </button>
          <button
            type="button"
            onClick={() => handleOpenAdd('chi')}
            className="min-h-[72px] bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-2xl font-black text-xl shadow-md flex items-center justify-center gap-2"
          >
            <Plus className="w-7 h-7" />
            <span>CHI TIỀN</span>
          </button>
        </div>

        {/* BOX TIN NHẮN ZALO + NÚT COPY */}
        <div className="bg-amber-50/70 border-2 border-amber-300 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-amber-950">Tin nhắn Zalo Sổ Quỹ</h3>
            <button
              type="button"
              onClick={handleCopyCashbookZalo}
              className={`min-h-[44px] px-4 py-2 rounded-xl font-bold text-base flex items-center gap-2 transition-all ${
                isCopiedZalo
                  ? 'bg-emerald-600 text-white'
                  : 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
              }`}
            >
              {isCopiedZalo ? (
                <>
                  <Check className="w-5 h-5" />
                  <span>Đã copy!</span>
                </>
              ) : (
                <>
                  <Copy className="w-5 h-5" />
                  <span>COPY</span>
                </>
              )}
            </button>
          </div>
          <div className="bg-white p-3 rounded-xl border border-amber-200 text-[15px] font-mono whitespace-pre-line text-gray-800 select-all leading-relaxed">
            {zaloCashbookMessage}
          </div>
        </div>

        {/* LỊCH SỬ NỘP/CHI */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs space-y-3">
          <h3 className="text-xl font-bold text-gray-900">Lịch sử thu chi quỹ</h3>
          {data.cashbook.length === 0 ? (
            <p className="text-gray-500 text-base italic py-4 text-center">
              Chưa có khoản nộp hoặc chi nào. Bấm NỘP TIỀN hoặc CHI TIỀN ở trên để ghi chép.
            </p>
          ) : (
            <div className="space-y-3">
              {data.cashbook.map((item) => {
                const isNop = item.type === 'nop';
                return (
                  <div
                    key={item.id}
                    className="p-3.5 bg-gray-50 rounded-2xl border border-gray-200 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Ảnh chứng từ nhỏ (nếu có, chạm xem to) */}
                      {item.receiptData ? (
                        <div
                          onClick={() => setPreviewImage(item.receiptData!)}
                          className="w-14 h-14 rounded-xl overflow-hidden border-2 border-blue-400 shrink-0 cursor-pointer relative group"
                        >
                          <img
                            src={item.receiptData}
                            alt="Chứng từ"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <ImageIcon className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-gray-200 flex items-center justify-center shrink-0 text-gray-400">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md text-xs font-black uppercase text-white ${
                              isNop ? 'bg-amber-600' : 'bg-red-600'
                            }`}
                          >
                            {isNop ? 'NỘP' : 'CHI'}
                          </span>
                          <span className="text-sm font-semibold text-gray-500">
                            {formatDateDisplay(item.date)}
                          </span>
                        </div>
                        <p className="text-lg font-bold text-gray-900 truncate mt-0.5">
                          {item.category}
                        </p>
                        <p className="text-sm text-gray-600 truncate">
                          {isNop ? `Nộp cho: ${item.person}` : `Người chi: ${item.person}`}
                        </p>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p
                        className={`text-xl font-black ${
                          isNop ? 'text-amber-700' : 'text-red-700'
                        }`}
                      >
                        {formatVND(item.amount)}
                      </p>
                      <div className="flex gap-1 justify-end mt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600"
                          title="Sửa"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmEntry(item)}
                          className="p-1.5 hover:bg-red-100 rounded-lg text-red-600"
                          title="Xoá"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal Form Nộp / Chi */}
      {modalType && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-2xl font-bold text-gray-900">
                {editingEntry
                  ? `Sửa bút toán ${modalType === 'nop' ? 'Nộp tiền' : 'Chi tiền'}`
                  : modalType === 'nop'
                  ? 'Ghi phiếu NỘP TIỀN'
                  : 'Ghi phiếu CHI TIỀN'}
              </h3>
              <button
                type="button"
                onClick={() => setModalType(null)}
                className="w-10 h-10 rounded-full hover:bg-gray-200 flex items-center justify-center text-gray-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div>
                <label className="block text-base font-bold text-gray-700 mb-1">Ngày ghi nhận</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full min-h-[50px] px-4 text-lg border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-base font-bold text-gray-700 mb-1">
                  {modalType === 'nop' ? 'Nộp khoản nào' : 'Chi khoản gì'}
                </label>
                <input
                  type="text"
                  value={entryCategory}
                  onChange={(e) => setEntryCategory(e.target.value)}
                  placeholder={
                    modalType === 'nop' ? 'VD: Quỹ lớp tháng 9, Bảo hiểm...' : 'VD: Mua giấy thi, Quà 20/11...'
                  }
                  className="w-full min-h-[50px] px-4 text-xl border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600 font-semibold"
                />
                {/* Gợi ý nhanh */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {(modalType === 'nop' ? feeSuggestions : chiSuggestions).map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setEntryCategory(sug)}
                      className="px-2.5 py-1 text-xs font-bold bg-gray-100 hover:bg-blue-100 text-gray-800 rounded-lg"
                    >
                      + {sug}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-base font-bold text-gray-700 mb-1">
                  {modalType === 'nop' ? 'Nộp bao nhiêu' : 'Bao nhiêu tiền'}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatNumberWithDots(entryAmountStr)}
                  onChange={(e) => setEntryAmountStr(e.target.value)}
                  placeholder="0"
                  className={`w-full min-h-[54px] px-4 text-2xl font-black border-2 rounded-xl outline-hidden ${
                    modalType === 'nop'
                      ? 'border-amber-400 text-amber-900 focus:border-amber-600'
                      : 'border-red-400 text-red-900 focus:border-red-600'
                  }`}
                />
                {numericAmount > 0 && (
                  <p className="text-sm text-gray-600 italic mt-1 font-semibold">
                    = {numberToVietnameseWords(numericAmount)}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-base font-bold text-gray-700 mb-1">
                  {modalType === 'nop' ? 'Nộp cho ai' : 'Ai chi'}
                </label>
                <input
                  type="text"
                  value={entryPerson}
                  onChange={(e) => setEntryPerson(e.target.value)}
                  placeholder={
                    modalType === 'nop' ? 'VD: Cô Lan chủ nhiệm, Nhà trường...' : 'VD: Ban phụ huynh, Cô Hoa...'
                  }
                  className="w-full min-h-[50px] px-4 text-lg border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-base font-bold text-gray-700 mb-1">
                  Ghi chú (tùy chọn)
                </label>
                <input
                  type="text"
                  value={entryNote}
                  onChange={(e) => setEntryNote(e.target.value)}
                  placeholder="Ghi chú thêm nếu có..."
                  className="w-full min-h-[50px] px-4 text-base border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600"
                />
              </div>

              {/* Ảnh chứng từ: chụp camera, upload file, nén canvas max 900px JPEG 0.6 */}
              <div>
                <label className="block text-base font-bold text-gray-700 mb-1">
                  Ảnh chứng từ / hoá đơn
                </label>
                {entryReceiptData ? (
                  <div className="relative w-36 h-36 rounded-2xl overflow-hidden border-2 border-blue-400 group">
                    <img
                      src={entryReceiptData}
                      alt="Chứng từ đã chọn"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setEntryReceiptData('')}
                      className="absolute top-1.5 right-1.5 bg-red-600 text-white rounded-full p-1.5 shadow-md"
                      title="Xoá ảnh"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full min-h-[90px] border-2 border-dashed border-gray-300 hover:border-blue-500 rounded-2xl cursor-pointer bg-gray-50 p-3 text-center">
                    <Camera className="w-8 h-8 text-gray-500 mb-1" />
                    <span className="text-base font-bold text-gray-700">
                      {isCompressingImage ? 'Đang nén ảnh...' : 'Chụp ảnh hoặc chọn từ máy'}
                    </span>
                    <span className="text-xs text-gray-400">Tự động nén gọn tiết kiệm dung lượng</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageFileChange}
                      disabled={isCompressingImage}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 bg-slate-50 space-y-2">
              <button
                type="button"
                disabled={isSubmitting || numericAmount <= 0}
                onClick={handleSaveEntry}
                className={`w-full min-h-[64px] text-white text-xl font-black rounded-2xl shadow-lg transition-all ${
                  modalType === 'nop'
                    ? 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
                    : 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                }`}
              >
                LƯU PHIẾU
              </button>
              {editingEntry && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmEntry(editingEntry)}
                  className="w-full py-2.5 text-red-600 hover:bg-red-50 font-bold text-base rounded-xl"
                >
                  Xoá bút toán này
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal phóng to ảnh chứng từ */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-2xl max-h-[90vh]">
            <img
              src={previewImage}
              alt="Ảnh phóng to"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-2"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
      )}

      {/* Modal xác nhận xoá bút toán */}
      <ConfirmModal
        isOpen={Boolean(deleteConfirmEntry)}
        title="Xác nhận xoá bút toán"
        message={`Bạn có chắc muốn xoá ${
          deleteConfirmEntry?.type === 'nop' ? 'khoản nộp' : 'khoản chi'
        } ${formatVND(deleteConfirmEntry?.amount || 0)} (${deleteConfirmEntry?.category})?`}
        confirmText="Xoá bút toán"
        isDanger={true}
        onConfirm={handleDeleteEntry}
        onCancel={() => setDeleteConfirmEntry(null)}
      />
    </div>
  );
}

// ============================================================================
// 6. MÀN HÌNH CÀI ĐẶT (SECTION 8)
// ============================================================================
function SettingsScreen({
  data,
  onBack,
  onOpenStudents,
  onOpenGoogleSheets,
  onOpenPublish,
  onUpdateData,
  onLockDevice
}: {
  data: AppData;
  onBack: () => void;
  onOpenStudents: () => void;
  onOpenGoogleSheets: () => void;
  onOpenPublish: () => void;
  onUpdateData: (newData: AppData, msg?: string) => Promise<void>;
  onLockDevice: () => void;
}) {
  const [classNameInput, setClassNameInput] = useState<string>(data.classInfo.className || '');
  const [teacherNameInput, setTeacherNameInput] = useState<string>(data.classInfo.teacherName || '');

  // Modal đổi passcode
  const [isChangePinModalOpen, setIsChangePinModalOpen] = useState<boolean>(false);
  const [oldPin, setOldPin] = useState<string>('');
  const [newPin, setNewPin] = useState<string>('');
  const [confirmNewPin, setConfirmNewPin] = useState<string>('');
  const [changePinError, setChangePinError] = useState<string>('');

  // Modal xoá toàn bộ dữ liệu (yêu cầu gõ "XOA")
  const [isResetModalOpen, setIsResetModalOpen] = useState<boolean>(false);
  const [resetConfirmWord, setResetConfirmWord] = useState<string>('');

  // Modal xoá dữ liệu mẫu
  const [isRemoveSampleModalOpen, setIsRemoveSampleModalOpen] = useState<boolean>(false);

  // File upload input ref cho phục hồi JSON
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lưu thông tin lớp khi người dùng nhập xong
  const handleSaveClassInfo = async () => {
    await onUpdateData(
      {
        ...data,
        classInfo: {
          ...data.classInfo,
          className: classNameInput.trim(),
          teacherName: teacherNameInput.trim()
        }
      },
      'Đã lưu thông tin lớp'
    );
  };

  // Đổi passcode
  const handleChangePin = async () => {
    setChangePinError('');
    if (oldPin !== data.passcode && (data.passcode || oldPin !== '6672')) {
      setChangePinError('Mã hiện tại không đúng');
      return;
    }
    if (!/^\d{4}$/.test(newPin)) {
      setChangePinError('Mã mới phải gồm đúng 4 chữ số');
      return;
    }
    if (newPin !== confirmNewPin) {
      setChangePinError('Xác nhận mã mới không khớp');
      return;
    }

    await onUpdateData({ ...data, passcode: newPin }, 'Đã đổi mã khoá thành công!');
    setIsChangePinModalOpen(false);
    setOldPin('');
    setNewPin('');
    setConfirmNewPin('');
  };

  // Sao lưu JSON
  const handleExportBackup = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute(
        'download',
        `so_thu_nop_backup_${data.classInfo.className || 'lop'}_${getTodayDateString()}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch {
      alert('Không thể tải file sao lưu');
    }
  };

  // Phục hồi từ file JSON
  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && typeof parsed === 'object') {
          if (confirm('Khôi phục dữ liệu sẽ ghi đè toàn bộ dữ liệu hiện tại. Bạn có chắc chắn?')) {
            await onUpdateData(parsed, 'Đã phục hồi dữ liệu từ file thành công!');
          }
        } else {
          alert('File JSON không hợp lệ');
        }
      } catch {
        alert('Lỗi đọc file backup');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Xoá dữ liệu mẫu (chắc chắn xoá sạch và lưu vào máy)
  const handleRemoveSampleData = async () => {
    const updated = removeSampleDataFrom(data);
    await onUpdateData(updated, 'Đã xoá học sinh & khoản thu mẫu thành công!');
    setIsRemoveSampleModalOpen(false);
  };

  // Xoá toàn bộ dữ liệu (xoá sạch toàn bộ và lưu vào máy)
  const handleResetAllData = async () => {
    if (resetConfirmWord.trim().toUpperCase() !== 'XOA') {
      alert('Vui lòng gõ chữ XOA để xác nhận');
      return;
    }

    const blank = resetAllDataFrom(data);
    await onUpdateData(blank, 'Đã xoá toàn bộ dữ liệu thành công!');
    setIsResetModalOpen(false);
    setResetConfirmWord('');
  };

  return (
    <div className="flex flex-col flex-1 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Về trang chủ</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">CÀI ĐẶT</h2>
        <div className="w-12"></div>
      </div>

      <div className="p-4 space-y-4">
        {/* 1. TÊN LỚP (BẮT BUỘC) */}
        <div
          className={`bg-white rounded-2xl p-4 border-2 shadow-xs ${
            !classNameInput.trim() ? 'border-red-400 bg-red-50/30' : 'border-gray-200'
          }`}
        >
          <label className="block text-xl font-bold text-gray-900 mb-1">
            Tên lớp <span className="text-red-600">(bắt buộc)</span>
          </label>
          <p className="text-sm text-gray-500 mb-2">
            Tên này sẽ xuất hiện trong tin nhắn Zalo gửi phụ huynh (VD: 5A, 12 Tin, 9B...).
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={classNameInput}
              onChange={(e) => setClassNameInput(e.target.value)}
              onBlur={handleSaveClassInfo}
              placeholder="VD: 5A, 9A1, 10 Tin..."
              className="flex-1 min-h-[52px] text-xl font-bold px-4 border-2 border-gray-300 rounded-xl outline-hidden focus:border-blue-600"
            />
            <button
              type="button"
              onClick={handleSaveClassInfo}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base rounded-xl shrink-0"
            >
              Lưu
            </button>
          </div>
          {!classNameInput.trim() && (
            <p className="text-sm font-bold text-red-600 mt-1">⚠️ Chưa có tên lớp!</p>
          )}

          <div className="mt-3 pt-3 border-t border-gray-100">
            <label className="block text-base font-semibold text-gray-700 mb-1">
              Tên cô giáo (tùy chọn)
            </label>
            <input
              type="text"
              value={teacherNameInput}
              onChange={(e) => setTeacherNameInput(e.target.value)}
              onBlur={handleSaveClassInfo}
              placeholder="VD: Cô Lan, Thầy Hùng..."
              className="w-full min-h-[48px] text-lg px-4 border border-gray-300 rounded-xl outline-hidden focus:border-blue-600"
            />
          </div>
        </div>

        {/* 2. DANH SÁCH HỌC SINH */}
        <button
          type="button"
          onClick={onOpenStudents}
          className="w-full min-h-[72px] bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-center justify-between text-left shadow-xs transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">Danh sách học sinh</p>
              <p className="text-sm text-gray-500">
                Đang có {data.students.length} học sinh • Dán từ Excel / Thêm sửa xoá
              </p>
            </div>
          </div>
          <span className="text-gray-400 text-2xl font-bold">›</span>
        </button>

        {/* 3. ĐỔI MÃ KHOÁ */}
        <button
          type="button"
          onClick={() => {
            setChangePinError('');
            setOldPin('');
            setNewPin('');
            setConfirmNewPin('');
            setIsChangePinModalOpen(true);
          }}
          className="w-full min-h-[72px] bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl p-4 flex items-center justify-between text-left shadow-xs transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-100 text-indigo-700 rounded-xl flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">Đổi mã khoá</p>
              <p className="text-sm text-gray-500">Đổi mã PIN 4 số bảo vệ sổ</p>
            </div>
          </div>
          <span className="text-gray-400 text-2xl font-bold">›</span>
        </button>

        {/* 4. SAO LƯU & PHỤC HỒI */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs space-y-3">
          <p className="text-xl font-bold text-gray-900">Sao lưu & Phục hồi dữ liệu</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleExportBackup}
              className="min-h-[56px] px-3 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-base rounded-xl flex items-center justify-center gap-2"
            >
              <Download className="w-5 h-5 text-emerald-700" />
              <span>Tải bản sao lưu</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[56px] px-3 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-900 font-bold text-base rounded-xl flex items-center justify-center gap-2"
            >
              <Upload className="w-5 h-5 text-blue-700" />
              <span>Phục hồi từ file</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleRestoreFile}
              className="hidden"
            />
          </div>
        </div>



        {/* 6. KẾT NỐI GOOGLE SHEET & GOOGLE APPS SCRIPT (GAS) */}
        <button
          type="button"
          onClick={onOpenGoogleSheets}
          className="w-full min-h-[72px] bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-300 rounded-2xl p-4 flex items-center justify-between text-left shadow-xs transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-600 text-white rounded-xl flex items-center justify-center shrink-0 shadow-xs">
              <FileSpreadsheet className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-950">Đồng bộ Google Sheet (GAS)</p>
              <p className="text-sm text-emerald-800">
                Lấy mã Google Apps Script • Tự động gửi dữ liệu sang Sheet
              </p>
            </div>
          </div>
          <span className="text-emerald-700 text-2xl font-bold">›</span>
        </button>

        {/* 7. ĐƯA LÊN MẠNG MIỄN PHÍ KHÔNG CẦN GOOGLE CLOUD */}
        <button
          type="button"
          onClick={onOpenPublish}
          className="w-full min-h-[72px] bg-sky-50 hover:bg-sky-100 border-2 border-sky-300 rounded-2xl p-4 flex items-center justify-between text-left shadow-xs transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-sky-600 text-white rounded-xl flex items-center justify-center shrink-0 shadow-xs">
              <Globe className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xl font-bold text-sky-950">Đưa lên mạng miễn phí (Không Cloud)</p>
              <p className="text-sm text-sky-800">
                Chạy vĩnh viễn trên Netlify, Vercel hoặc cài thẳng vào điện thoại (PWA)
              </p>
            </div>
          </div>
          <span className="text-sky-700 text-2xl font-bold">›</span>
        </button>

        {/* XOÁ DỮ LIỆU MẪU (NẾU CÓ DỮ LIỆU MẪU) */}
        <button
          type="button"
          onClick={() => setIsRemoveSampleModalOpen(true)}
          className="w-full min-h-[56px] bg-white hover:bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl p-4 flex items-center justify-between text-left shadow-xs"
        >
          <span className="text-lg font-bold">Xoá dữ liệu mẫu ban đầu</span>
          <Trash2 className="w-5 h-5 text-amber-700" />
        </button>

        {/* 6. KHOÁ THIẾT BỊ NÀY */}
        <button
          type="button"
          onClick={onLockDevice}
          className="w-full min-h-[56px] bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-2xl p-4 flex items-center justify-between text-left font-bold text-lg shadow-xs"
        >
          <span>Khoá thiết bị này</span>
          <Lock className="w-5 h-5 text-gray-600" />
        </button>

        {/* 7. XOÁ TOÀN BỘ DỮ LIỆU */}
        <button
          type="button"
          onClick={() => {
            setResetConfirmWord('');
            setIsResetModalOpen(true);
          }}
          className="w-full min-h-[56px] bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 rounded-2xl p-4 flex items-center justify-between text-left font-bold text-lg shadow-xs"
        >
          <span>Xoá toàn bộ dữ liệu</span>
          <Trash2 className="w-5 h-5 text-red-600" />
        </button>
      </div>

      {/* Modal Đổi mã khoá */}
      {isChangePinModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Đổi mã khoá 4 số</h3>
            {changePinError && (
              <p className="text-red-600 font-bold text-base mb-3 bg-red-50 p-2 rounded-lg">
                {changePinError}
              </p>
            )}
            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Mã cũ</label>
                <input
                  type="password"
                  maxLength={4}
                  inputMode="numeric"
                  value={oldPin}
                  onChange={(e) => setOldPin(e.target.value)}
                  placeholder="Mã hiện tại"
                  className="w-full px-4 py-2.5 text-2xl font-mono text-center border-2 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Mã mới 4 số</label>
                <input
                  type="password"
                  maxLength={4}
                  inputMode="numeric"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  placeholder="4 số mới"
                  className="w-full px-4 py-2.5 text-2xl font-mono text-center border-2 rounded-xl"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Nhập lại mã mới
                </label>
                <input
                  type="password"
                  maxLength={4}
                  inputMode="numeric"
                  value={confirmNewPin}
                  onChange={(e) => setConfirmNewPin(e.target.value)}
                  placeholder="Nhập lại 4 số mới"
                  className="w-full px-4 py-2.5 text-2xl font-mono text-center border-2 rounded-xl"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsChangePinModalOpen(false)}
                className="flex-1 py-3 bg-gray-100 rounded-xl font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleChangePin}
                className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold"
              >
                Đổi mã
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xoá toàn bộ dữ liệu */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-2xl font-black text-red-600 mb-2">CẢNH BÁO NGUY HIỂM</h3>
            <p className="text-base text-gray-700 mb-4 leading-relaxed">
              Hành động này sẽ xoá sạch toàn bộ danh sách học sinh, khoản thu, lịch sử nộp tiền và sổ
              thu chi.
            </p>
            <p className="text-base font-bold text-gray-900 mb-2">
              Gõ chữ <span className="text-red-600">XOA</span> vào ô dưới để xác nhận:
            </p>
            <input
              type="text"
              value={resetConfirmWord}
              onChange={(e) => setResetConfirmWord(e.target.value)}
              placeholder="Gõ XOA"
              className="w-full px-4 py-3 text-xl font-black text-center border-2 border-red-400 rounded-xl mb-5 uppercase"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="flex-1 py-3 bg-gray-100 rounded-xl font-bold"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleResetAllData}
                disabled={resetConfirmWord.trim().toUpperCase() !== 'XOA'}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-xl font-bold"
              >
                XÁC NHẬN XOÁ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xoá dữ liệu mẫu */}
      <ConfirmModal
        isOpen={isRemoveSampleModalOpen}
        title="Xoá học sinh & khoản thu mẫu"
        message="Bạn có muốn xoá các học sinh và khoản thu mẫu ban đầu (An, Bình, Cường, Dung, Đức) để bắt đầu nhập danh sách thực tế của lớp?"
        confirmText="Xoá mẫu"
        isDanger={true}
        onConfirm={handleRemoveSampleData}
        onCancel={() => setIsRemoveSampleModalOpen(false)}
      />
    </div>
  );
}

// ============================================================================
// 7. MÀN HÌNH QUẢN LÝ DANH SÁCH HỌC SINH (SECTION 8.2)
// ============================================================================
function SettingsStudentsScreen({
  data,
  onBack,
  onUpdateData
}: {
  data: AppData;
  onBack: () => void;
  onUpdateData: (newData: AppData, msg?: string) => Promise<void>;
}) {
  const [pasteText, setPasteText] = useState<string>('');
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [singleStudentName, setSingleStudentName] = useState<string>('');

  // Modal sửa tên học sinh
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  // Modal xác nhận xoá học sinh
  const [deleteConfirmStudent, setDeleteConfirmStudent] = useState<Student | null>(null);

  // Preview import từ Excel
  const [previewImport, setPreviewImport] = useState<{
    newStudents: string[];
    duplicates: string[];
  } | null>(null);

  // Phân tích danh sách từ Excel
  const handleParseExcel = () => {
    if (!pasteText.trim()) {
      alert('Vui lòng dán danh sách từ Excel vào ô trước');
      return;
    }

    const lines = pasteText.split(/\r?\n/);
    const candidateNames: string[] = [];

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      // Bỏ qua dòng tiêu đề
      const lower = line.toLowerCase();
      if (
        lower.includes('họ tên') ||
        lower.includes('họ và tên') ||
        lower.includes('stt') ||
        lower.includes('tên học sinh')
      ) {
        return;
      }

      // Tách theo tab, |, hoặc 2+ khoảng trắng, hoặc dấu phẩy
      const cols = line.split(/\t|\||\s{2,}/);
      if (cols.length > 0) {
        // Lấy cột cuối cùng làm tên
        let name = cols[cols.length - 1].trim();
        // Xoá số thứ tự đầu dòng nếu có (VD: "1. Nguyễn Văn An" -> "Nguyễn Văn An")
        name = name.replace(/^\d+[\.\-\s]+/, '').trim();
        if (name && name.length >= 2) {
          candidateNames.push(name);
        }
      }
    });

    if (candidateNames.length === 0) {
      alert('Không nhận diện được tên học sinh nào từ nội dung dán!');
      return;
    }

    // Kiểm tra trùng lặp với danh sách hiện có
    const existingLower = new Set(data.students.map((s) => s.name.trim().toLowerCase()));
    const newStudents: string[] = [];
    const duplicates: string[] = [];

    candidateNames.forEach((n) => {
      if (existingLower.has(n.toLowerCase())) {
        duplicates.push(n);
      } else {
        newStudents.push(n);
        existingLower.add(n.toLowerCase());
      }
    });

    setPreviewImport({ newStudents, duplicates });
  };

  // Xác nhận nhập từ preview
  const handleConfirmImport = async () => {
    if (!previewImport) return;

    let maxOrder = data.students.reduce((max, s) => Math.max(max, s.order || 0), 0);
    const toAdd: Student[] = previewImport.newStudents.map((name) => {
      maxOrder += 1;
      return {
        id: crypto.randomUUID ? crypto.randomUUID() : `hs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        order: maxOrder
      };
    });

    const updatedStudents = [...data.students, ...toAdd];
    await onUpdateData(
      { ...data, students: updatedStudents },
      `Đã thêm ${toAdd.length} học sinh vào lớp!`
    );

    setPreviewImport(null);
    setPasteText('');
  };

  // Thêm 1 học sinh thủ công
  const handleAddSingleStudent = async () => {
    if (!singleStudentName.trim()) return;
    const maxOrder = data.students.reduce((max, s) => Math.max(max, s.order || 0), 0);
    const newStu: Student = {
      id: crypto.randomUUID ? crypto.randomUUID() : `hs_${Date.now()}`,
      name: singleStudentName.trim(),
      order: maxOrder + 1
    };

    await onUpdateData(
      { ...data, students: [...data.students, newStu] },
      `Đã thêm ${newStu.name}`
    );
    setSingleStudentName('');
    setIsAddModalOpen(false);
  };

  // Sửa tên học sinh
  const handleSaveEditStudent = async () => {
    if (!editingStudent || !editingName.trim()) return;
    const updated = data.students.map((s) =>
      s.id === editingStudent.id ? { ...s, name: editingName.trim() } : s
    );
    await onUpdateData({ ...data, students: updated }, 'Đã sửa tên học sinh');
    setEditingStudent(null);
  };

  // Xoá học sinh
  const handleDeleteStudent = async () => {
    if (!deleteConfirmStudent) return;
    const id = deleteConfirmStudent.id;
    const updatedStudents = data.students.filter((s) => s.id !== id);
    // Xoá các payment liên quan
    const updatedPayments = data.payments.filter((p) => p.studentId !== id);
    // Xoá khỏi exemptStudentIds của fees
    const updatedFees = data.fees.map((f) => ({
      ...f,
      exemptStudentIds: (f.exemptStudentIds || []).filter((stuId) => stuId !== id)
    }));

    await onUpdateData(
      { ...data, students: updatedStudents, payments: updatedPayments, fees: updatedFees },
      `Đã xoá ${deleteConfirmStudent.name}`
    );
    setDeleteConfirmStudent(null);
  };

  // Di chuyển thứ tự học sinh lên / xuống
  const handleMoveOrder = async (index: number, direction: 'up' | 'down') => {
    const list = [...data.students].sort((a, b) => a.order - b.order);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;

    // Cập nhật lại số thứ tự
    const reordered = list.map((s, idx) => ({ ...s, order: idx + 1 }));
    await onUpdateData({ ...data, students: reordered });
  };

  const sortedStudents = [...data.students].sort((a, b) => a.order - b.order);

  // Cảnh báo nếu học sinh có lịch sử thanh toán
  const deleteWarningMessage = useMemo(() => {
    if (!deleteConfirmStudent) return '';
    const stuPayments = data.payments.filter((p) => p.studentId === deleteConfirmStudent.id);
    const totalPaid = stuPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    if (stuPayments.length > 0) {
      return `⚠️ CẢNH BÁO: Học sinh "${deleteConfirmStudent.name}" đã có ${stuPayments.length} lần nộp tiền (${formatVND(totalPaid)}).\nXoá học sinh sẽ XOÁ LUÔN toàn bộ lịch sử nộp tiền này!`;
    }
    return `Bạn có chắc muốn xoá học sinh "${deleteConfirmStudent.name}" khỏi danh sách lớp?`;
  }, [deleteConfirmStudent, data.payments]);

  return (
    <div className="flex flex-col flex-1 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Cài đặt</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">DANH SÁCH HS</h2>
        <div className="w-12"></div>
      </div>

      <div className="p-4 space-y-5">
        {/* KHU DÁN TỪ EXCEL */}
        <div className="bg-white border-2 border-blue-200 rounded-2xl p-4 shadow-xs space-y-3">
          <label className="block text-xl font-bold text-gray-900">
            Dán danh sách từ Excel (2 cột: STT | Họ tên)
          </label>
          <textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Dán từ Excel vào đây...\nVí dụ:\n1\tNguyễn Văn An\n2\tTrần Thị Bình\n3\tLê Hoàng Cường`}
            className="w-full p-3 border-2 border-gray-300 rounded-xl text-base font-mono outline-hidden focus:border-blue-600"
          />
          <button
            type="button"
            onClick={handleParseExcel}
            className="w-full min-h-[52px] bg-blue-600 hover:bg-blue-700 text-white font-bold text-lg rounded-xl shadow-md flex items-center justify-center gap-2"
          >
            <Upload className="w-5 h-5" />
            <span>NHẬP DANH SÁCH</span>
          </button>
        </div>

        {/* Nút Thêm 1 học sinh thủ công */}
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">
            Hiện có {data.students.length} học sinh
          </h3>
          <button
            type="button"
            onClick={() => {
              setSingleStudentName('');
              setIsAddModalOpen(true);
            }}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base rounded-xl flex items-center gap-1 shadow-xs"
          >
            <Plus className="w-5 h-5" />
            <span>Thêm 1 em</span>
          </button>
        </div>

        {/* Danh sách học sinh hiện có */}
        <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden shadow-xs">
          {sortedStudents.map((student, idx) => (
            <div
              key={student.id}
              className="p-3.5 flex items-center justify-between gap-2 hover:bg-gray-50"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                  {idx + 1}
                </span>
                <span className="text-xl font-bold text-gray-900 truncate">{student.name}</span>
              </div>

              {/* Nút lên / xuống / sửa / xoá */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => handleMoveOrder(idx, 'up')}
                  className="p-2 hover:bg-gray-200 disabled:opacity-20 rounded-lg text-gray-600"
                  title="Di chuyển lên"
                >
                  <ArrowUp className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={idx === sortedStudents.length - 1}
                  onClick={() => handleMoveOrder(idx, 'down')}
                  className="p-2 hover:bg-gray-200 disabled:opacity-20 rounded-lg text-gray-600"
                  title="Di chuyển xuống"
                >
                  <ArrowDown className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingStudent(student);
                    setEditingName(student.name);
                  }}
                  className="p-2 hover:bg-blue-100 rounded-lg text-blue-600"
                  title="Sửa tên"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmStudent(student)}
                  className="p-2 hover:bg-red-100 rounded-lg text-red-600"
                  title="Xoá"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Preview Import từ Excel */}
      {previewImport && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl max-h-[85vh] flex flex-col">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">Xem trước danh sách</h3>
            <div className="space-y-1 mb-4 text-base">
              <p className="font-bold text-blue-700">
                ✓ Sẽ thêm mới: {previewImport.newStudents.length} học sinh
              </p>
              {previewImport.duplicates.length > 0 && (
                <p className="font-semibold text-amber-700">
                  ⚠️ Bỏ qua {previewImport.duplicates.length} tên đã có trong lớp: (
                  {previewImport.duplicates.join(', ')})
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-xl p-3 bg-gray-50 mb-5 divide-y divide-gray-200 text-base">
              {previewImport.newStudents.map((name, i) => (
                <div key={i} className="py-1.5 flex items-center gap-2">
                  <span className="text-gray-400 font-bold">{i + 1}.</span>
                  <span className="font-bold text-gray-800">{name}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPreviewImport(null)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-bold text-gray-800"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={previewImport.newStudents.length === 0}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-bold"
              >
                XÁC NHẬN THÊM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Thêm 1 học sinh */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-3">Thêm học sinh mới</h3>
            <input
              type="text"
              value={singleStudentName}
              onChange={(e) => setSingleStudentName(e.target.value)}
              placeholder="Nhập họ và tên..."
              className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-xl mb-4 font-bold"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 py-2.5 bg-gray-100 rounded-xl font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleAddSingleStudent}
                disabled={!singleStudentName.trim()}
                className="flex-1 py-2.5 bg-blue-600 disabled:opacity-50 text-white rounded-xl font-bold"
              >
                Thêm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Sửa tên học sinh */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-5 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-gray-900 mb-3">Sửa tên học sinh</h3>
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-xl mb-4 font-bold"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingStudent(null)}
                className="flex-1 py-2.5 bg-gray-100 rounded-xl font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSaveEditStudent}
                disabled={!editingName.trim()}
                className="flex-1 py-2.5 bg-blue-600 disabled:opacity-50 text-white rounded-xl font-bold"
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Xác nhận xoá học sinh */}
      <ConfirmModal
        isOpen={Boolean(deleteConfirmStudent)}
        title="Xác nhận xoá học sinh"
        message={deleteWarningMessage}
        confirmText="Xoá học sinh"
        isDanger={true}
        onConfirm={handleDeleteStudent}
        onCancel={() => setDeleteConfirmStudent(null)}
      />
    </div>
  );
}

// ============================================================================
// 8. MÀN HÌNH ĐỒNG BỘ GOOGLE SHEET & GOOGLE APPS SCRIPT (GAS)
// ============================================================================
function SettingsGoogleSheetsScreen({
  data,
  onBack,
  onUpdateData
}: {
  data: AppData;
  onBack: () => void;
  onUpdateData: (newData: AppData, msg?: string) => Promise<void>;
}) {
  // Web App GAS URL
  const [gasUrl, setGasUrl] = useState<string>(() => {
    return localStorage.getItem('gas_webapp_url') || '';
  });
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    return localStorage.getItem('gas_auto_sync') === '1';
  });
  const [isCopiedCode, setIsCopiedCode] = useState<boolean>(false);
  const [isSyncingGas, setIsSyncingGas] = useState<boolean>(false);
  const [isFetchingGas, setIsFetchingGas] = useState<boolean>(false);
  const [gasMessage, setGasMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>(() => {
    return localStorage.getItem('gas_last_sync') || '';
  });
  const [isConfirmFetchOpen, setIsConfirmFetchOpen] = useState<boolean>(false);

  // Copy mã Google Apps Script
  const handleCopyCode = async () => {
    const ok = await copyTextToClipboard(GAS_SCRIPT_CODE);
    if (ok) {
      setIsCopiedCode(true);
      setTimeout(() => setIsCopiedCode(false), 2500);
    }
  };

  // Lưu URL Web App
  const handleSaveGasUrl = () => {
    const trimmed = gasUrl.trim();
    localStorage.setItem('gas_webapp_url', trimmed);
    setGasMessage({ text: 'Đã lưu đường link Web App Google Apps Script!', isError: false });
  };

  // Bật/tắt tự động đồng bộ
  const handleToggleAutoSync = () => {
    const next = !autoSync;
    setAutoSync(next);
    localStorage.setItem('gas_auto_sync', next ? '1' : '0');
  };

  // Đồng bộ lên Google Sheet qua GAS Web App
  const handleSyncToGas = async () => {
    if (!gasUrl.trim()) {
      setGasMessage({
        text: 'Vui lòng dán đường link URL Web App Apps Script (kết thúc bằng /exec) vào ô dưới trước.',
        isError: true
      });
      return;
    }

    setIsSyncingGas(true);
    setGasMessage(null);
    const result = await syncToGoogleSheetGas(gasUrl, data);
    setIsSyncingGas(false);

    if (result.success) {
      const timeStr =
        new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');
      setLastSyncTime(timeStr);
      localStorage.setItem('gas_last_sync', timeStr);
      setGasMessage({ text: '✓ ' + result.message, isError: false });
    } else {
      setGasMessage({ text: '✕ ' + result.message, isError: true });
    }
  };

  // Tải dữ liệu từ Google Sheet về App
  const executeFetchFromGas = async () => {
    setIsConfirmFetchOpen(false);
    if (!gasUrl.trim()) {
      setGasMessage({
        text: 'Vui lòng dán đường link URL Web App Apps Script vào ô dưới trước.',
        isError: true
      });
      return;
    }

    setIsFetchingGas(true);
    setGasMessage(null);
    const result = await fetchFromGoogleSheetGas(gasUrl);
    setIsFetchingGas(false);

    if (result.success && result.data) {
      await onUpdateData(result.data, 'Đã tải dữ liệu từ Google Sheet thành công!');
      const timeStr =
        new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN');
      setLastSyncTime(timeStr);
      localStorage.setItem('gas_last_sync', timeStr);
      setGasMessage({ text: '✓ ' + result.message, isError: false });
    } else {
      setGasMessage({ text: '✕ ' + result.message, isError: true });
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Cài đặt</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">KẾT NỐI GOOGLE SHEET</h2>
        <div className="w-12"></div>
      </div>

      <div className="p-4 space-y-5">
        {/* Banner giới thiệu */}
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 shadow-xs">
          <div className="flex items-center gap-3 mb-1">
            <FileSpreadsheet className="w-8 h-8 text-emerald-700 shrink-0" />
            <div>
              <h3 className="text-xl font-bold text-emerald-950">
                Google Sheets làm Cơ sở dữ liệu (Database)
              </h3>
              <p className="text-base text-emerald-800">
                Đồng bộ hai chiều giữa ứng dụng và Google Sheets qua Google Apps Script (GAS). Toàn bộ dữ liệu lớp học được lưu giữ an toàn trên Google Drive của bạn.
              </p>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* PHẦN 1: MÃ GOOGLE APPS SCRIPT (GAS) ĐỂ MANG SANG SHEET */}
        {/* ================================================================= */}
        <div className="bg-white border-2 border-blue-300 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 border-gray-200">
            <div>
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Code className="w-6 h-6 text-blue-600" />
                <span>1. Hộp mã Google Apps Script (GAS)</span>
              </h3>
              <p className="text-sm text-gray-600">
                Bấm nút dưới để chép mã và dán vào Google Sheet của bạn
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyCode}
              className={`min-h-[50px] px-5 py-2.5 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-md shrink-0 ${
                isCopiedCode
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white'
              }`}
            >
              {isCopiedCode ? (
                <>
                  <Check className="w-6 h-6" />
                  <span>Đã copy mã!</span>
                </>
              ) : (
                <>
                  <Copy className="w-6 h-6" />
                  <span>COPY MÃ SCRIPT</span>
                </>
              )}
            </button>
          </div>

          {/* Khung hiển thị mã nguồn */}
          <div className="bg-slate-900 text-slate-100 rounded-xl p-3 font-mono text-xs sm:text-sm overflow-x-auto max-h-[260px] border border-slate-700 shadow-inner">
            <pre className="text-emerald-400 whitespace-pre">{GAS_SCRIPT_CODE}</pre>
          </div>

          {/* Hướng dẫn 5 bước siêu ngắn gọn */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-sm sm:text-base text-gray-800 space-y-2 leading-relaxed">
            <p className="font-bold text-base text-gray-900 mb-1">📋 Cách mang sang Google Sheet (5 bước):</p>
            <p>1. Mở trang tính Google Sheet mới (vào <b>sheet.new</b>) hoặc file có sẵn.</p>
            <p>2. Chọn menu <b>Tiện ích mở rộng (Extensions)</b> → <b>Apps Script</b>.</p>
            <p>3. Xoá hết mã cũ, dán đoạn mã vừa copy ở trên vào → Bấm <b>Lưu (Ctrl+S)</b>.</p>
            <p>
              4. Bấm nút <b>Triển khai (Deploy)</b> ở góc trên phải → <b>Tùy chọn triển khai mới (New deployment)</b>:
              <br />• Chọn loại: <b>Ứng dụng web (Web app)</b>.
              <br />• Ai có quyền truy cập: chọn <b className="text-blue-700">Bất kỳ ai (Anyone)</b>.
            </p>
            <p>
              5. Bấm <b>Triển khai</b> (chọn cấp quyền nếu Google hỏi) → Sao chép <b>URL ứng dụng web</b> (link kết thúc bằng{' '}
              <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono text-red-600 font-bold">/exec</code>) dán vào ô bên dưới!
            </p>
          </div>
        </div>

        {/* ================================================================= */}
        {/* PHẦN 2: CẤU HÌNH LIÊN KẾT WEB APP URL & ĐỒNG BỘ HAI CHIỀU */}
        {/* ================================================================= */}
        <div className="bg-white border-2 border-emerald-300 rounded-2xl p-4 shadow-sm space-y-4">
          <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            <span>2. Cấu hình liên kết & Đồng bộ</span>
          </h3>

          <div>
            <label className="block text-base font-bold text-gray-800 mb-1">
              URL ứng dụng web Apps Script (kết thúc bằng /exec)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={gasUrl}
                onChange={(e) => setGasUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="flex-1 min-h-[50px] px-3 text-base border-2 border-gray-300 focus:border-emerald-600 rounded-xl outline-hidden font-mono"
              />
              <button
                type="button"
                onClick={handleSaveGasUrl}
                className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold text-base rounded-xl shrink-0 shadow-xs"
              >
                Lưu link
              </button>
            </div>
          </div>

          {/* Toggle tự động đồng bộ */}
          <div
            onClick={handleToggleAutoSync}
            className={`p-3.5 rounded-xl border-2 flex items-center justify-between cursor-pointer transition-colors ${
              autoSync ? 'bg-emerald-50 border-emerald-400' : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div>
              <p className="text-lg font-bold text-gray-900">Tự động đồng bộ lên Google Sheet</p>
              <p className="text-sm text-gray-600">
                Tự động gửi cập nhật mỗi khi ghi nhận tiền nộp hoặc chi tiêu
              </p>
            </div>
            <div
              className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 ${
                autoSync ? 'bg-emerald-600 justify-end' : 'bg-gray-300 justify-start'
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-white shadow-md"></div>
            </div>
          </div>

          {/* 2 nút hành động lớn: Đồng bộ lên Sheet & Tải về từ Sheet */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              disabled={isSyncingGas}
              onClick={handleSyncToGas}
              className="min-h-[64px] bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white font-black text-lg rounded-2xl shadow-md flex items-center justify-center gap-2"
            >
              <Upload className={`w-6 h-6 ${isSyncingGas ? 'animate-bounce' : ''}`} />
              <span>{isSyncingGas ? 'ĐANG ĐỒNG BỘ...' : 'ĐỒNG BỘ LÊN SHEET'}</span>
            </button>

            <button
              type="button"
              disabled={isFetchingGas}
              onClick={() => setIsConfirmFetchOpen(true)}
              className="min-h-[64px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-black text-lg rounded-2xl shadow-md flex items-center justify-center gap-2"
            >
              <Download className={`w-6 h-6 ${isFetchingGas ? 'animate-bounce' : ''}`} />
              <span>{isFetchingGas ? 'ĐANG TẢI VỀ...' : 'TẢI DỮ LIỆU TỪ SHEET'}</span>
            </button>
          </div>

          {/* Trạng thái / Thông báo kết quả */}
          {gasMessage && (
            <div
              className={`p-3 rounded-xl border text-base font-bold text-center ${
                gasMessage.isError
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-emerald-50 border-emerald-300 text-emerald-800'
              }`}
            >
              {gasMessage.text}
            </div>
          )}

          {lastSyncTime && (
            <p className="text-sm text-center text-gray-500 font-medium">
              Đồng bộ thành công gần nhất: <b>{lastSyncTime}</b>
            </p>
          )}
        </div>
      </div>

      {/* Modal xác nhận tải dữ liệu từ Google Sheet */}
      <ConfirmModal
        isOpen={isConfirmFetchOpen}
        title="Tải dữ liệu từ Google Sheet?"
        message="Dữ liệu từ Google Sheet sẽ ghi đè vào ứng dụng trên máy này. Bạn có chắc chắn muốn tải về?"
        confirmText="Tải về ngay"
        cancelText="Hủy"
        onConfirm={executeFetchFromGas}
        onCancel={() => setIsConfirmFetchOpen(false)}
      />
    </div>
  );
}

// ============================================================================
// 9. MÀN HÌNH HƯỚNG DẪN XUẤT BẢN MIỄN PHÍ (KHÔNG QUA GOOGLE CLOUD)
// ============================================================================
function SettingsPublishScreen({ onBack }: { onBack: () => void }) {
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  const currentWebUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopyCurrentUrl = async () => {
    const ok = await copyTextToClipboard(currentWebUrl);
    if (ok) {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2500);
    }
  };

  return (
    <div className="flex flex-col flex-1 pb-16">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[48px] px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl flex items-center gap-1 text-gray-800 font-bold text-lg"
        >
          <ChevronLeft className="w-7 h-7" />
          <span>Cài đặt</span>
        </button>
        <h2 className="text-2xl font-black text-gray-900">XUẤT BẢN MIỄN PHÍ</h2>
        <div className="w-12"></div>
      </div>

      <div className="p-4 space-y-5">
        {/* Banner thông tin quan trọng */}
        <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4 shadow-xs">
          <div className="flex items-start gap-3">
            <Globe className="w-8 h-8 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xl font-black text-blue-950 mb-1">
                Hoàn toàn Miễn Phí 100% — Không cần Google Cloud!
              </h3>
              <p className="text-base text-blue-900 leading-relaxed">
                Ứng dụng <b>SỔ THU NỘP</b> là ứng dụng web tĩnh (Static Web App). Toàn bộ dữ liệu được lưu trên máy của bạn và đồng bộ qua <b>Google Sheets</b> (bằng Google Apps Script). Bạn <b>không cần bất kỳ máy chủ nào</b> và có thể chạy vĩnh viễn miễn phí theo 3 cách dưới đây:
              </p>
            </div>
          </div>
        </div>

        {/* CÁCH 1: CÀI VÀO ĐIỆN THOẠI (PWA) */}
        <div className="bg-white border-2 border-emerald-300 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-600 text-white rounded-xl flex items-center justify-center shrink-0">
              <Smartphone className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-black text-emerald-950">
                Cách 1: Cài thẳng vào điện thoại (Khuyên dùng)
              </h3>
              <p className="text-sm text-emerald-800">
                Không cần mua tên miền, mở như ứng dụng thật từ màn hình chính
              </p>
            </div>
          </div>

          <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200 text-base text-gray-800 space-y-2.5 leading-relaxed">
            <p className="font-bold text-emerald-950">📱 Hướng dẫn cài trên điện thoại:</p>
            <div className="space-y-2">
              <div className="p-2.5 bg-white rounded-lg border border-emerald-100">
                <p className="font-bold text-gray-900">🍏 Trên iPhone (Trình duyệt Safari):</p>
                <p className="text-sm text-gray-700">
                  Mở link web này bằng Safari → Bấm nút <b>Chia sẻ</b> (biểu tượng hình vuông có mũi tên chỉ lên ở thanh dưới) → Cuộn xuống chọn <b>"Thêm vào MH chính"</b> (Add to Home Screen).
                </p>
              </div>
              <div className="p-2.5 bg-white rounded-lg border border-emerald-100">
                <p className="font-bold text-gray-900">🤖 Trên Android (Chrome / Samsung Internet):</p>
                <p className="text-sm text-gray-700">
                  Mở link web bằng Chrome → Bấm nút <b>3 chấm</b> ở góc trên bên phải → Chọn <b>"Cài đặt ứng dụng"</b> hoặc <b>"Thêm vào màn hình chính"</b>.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCopyCurrentUrl}
            className={`w-full min-h-[54px] rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-md ${
              copiedUrl
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
            }`}
          >
            {copiedUrl ? (
              <>
                <Check className="w-5 h-5" />
                <span>Đã sao chép link web! Hãy dán gửi vào Zalo</span>
              </>
            ) : (
              <>
                <Copy className="w-5 h-5" />
                <span>SAO CHÉP LINK WEB ĐỂ MỞ TRÊN ĐIỆN THOẠI</span>
              </>
            )}
          </button>
        </div>

        {/* CÁCH 2: NETLIFY DROP (KÉO THẢ TRONG 30 GIÂY) */}
        <div className="bg-white border-2 border-indigo-300 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 text-white rounded-xl flex items-center justify-center shrink-0">
              <Upload className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-black text-indigo-950">
                Cách 2: Đưa lên Netlify Drop (30 giây là xong)
              </h3>
              <p className="text-sm text-indigo-800">
                Có ngay địa chỉ web riêng dạng https://ten-lop.netlify.app miễn phí vĩnh viễn
              </p>
            </div>
          </div>

          <div className="bg-indigo-50/60 p-3.5 rounded-xl border border-indigo-200 text-base text-gray-800 space-y-2 leading-relaxed">
            <p className="font-bold text-indigo-950">🚀 3 bước đưa lên Netlify Drop:</p>
            <p>
              1. Chạy lệnh đóng gói: <code className="bg-white px-2 py-0.5 rounded border border-indigo-200 font-mono text-indigo-700 font-bold">npm run build</code> (sẽ tạo ra thư mục mang tên <b>dist</b>).
            </p>
            <p>
              2. Mở trình duyệt vào trang: <a href="https://app.netlify.com/drop" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold underline inline-flex items-center gap-1">app.netlify.com/drop <ExternalLink className="w-3.5 h-3.5 inline" /></a>
            </p>
            <p>
              3. <b>Kéo và thả thư mục "dist"</b> vào vòng tròn trên trang Netlify.
            </p>
            <p className="text-emerald-800 font-semibold bg-emerald-50 p-2 rounded-lg">
              ✓ Sau 5-10 giây, Netlify sẽ cấp cho bạn một đường link web miễn phí vĩnh viễn (có bảo mật khóa xanh HTTPS). Bạn có thể đổi tên link tùy ý trong mục Site Settings của Netlify!
            </p>
          </div>
        </div>

        {/* CÁCH 3: VERCEL HOẶC GITHUB PAGES */}
        <div className="bg-white border-2 border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gray-800 text-white rounded-xl flex items-center justify-center shrink-0">
              <Globe className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900">
                Cách 3: Vercel hoặc GitHub Pages
              </h3>
              <p className="text-sm text-gray-600">
                Miễn phí 100% cho mọi dự án cá nhân và lớp học
              </p>
            </div>
          </div>

          <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-200 text-sm sm:text-base text-gray-700 space-y-1.5 leading-relaxed">
            <p>
              • <b>Vercel (<a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">vercel.com</a>):</b> Hỗ trợ kéo thả thư mục <b>dist</b> hoặc kết nối trực tiếp kho lưu trữ GitHub. Tự động cập nhật mỗi khi có thay đổi.
            </p>
            <p>
              • <b>GitHub Pages:</b> Vào cài đặt Repository trên GitHub → Mục <b>Pages</b> → Chọn nhánh xuất bản để có trang web miễn phí dạng <code className="bg-gray-200 px-1 rounded text-gray-800 font-mono">ten-ban.github.io/ten-repo</code>.
            </p>
          </div>
        </div>

        {/* Ghi chú về dữ liệu */}
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 text-amber-950 text-base leading-relaxed space-y-1">
          <p className="font-bold flex items-center gap-2 text-lg">
            <span>🛡️ Dữ liệu của bạn được bảo toàn tuyệt đối</span>
          </p>
          <p>
            Dù bạn chạy ứng dụng ở bất kỳ dịch vụ miễn phí nào (Netlify, Vercel, điện thoại...), toàn bộ số liệu thu chi của lớp đều được tự động đồng bộ về file <b>Google Sheets</b> trên Google Drive của bạn (qua Apps Script bạn đã kết nối). Không bao giờ lo bị mất dữ liệu!
          </p>
        </div>
      </div>
    </div>
  );
}


