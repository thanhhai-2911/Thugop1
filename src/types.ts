export interface Student {
  id: string;
  name: string;
  order: number;
}

export interface Fee {
  id: string;
  name: string;
  amount: number;
  exemptStudentIds: string[];
  createdAt: string;
}

export interface Payment {
  id: string;
  studentId: string;
  amount: number;
  date: string; // YYYY-MM-DD
  note?: string;
  createdAt: string;
}

export interface CashbookEntry {
  id: string;
  type: 'nop' | 'chi';
  date: string; // YYYY-MM-DD
  category: string;
  amount: number;
  person: string;
  note?: string;
  receiptData?: string; // compressed base64 jpeg
  createdAt: string;
}

export interface ClassInfo {
  className: string;
  teacherName?: string;
  note?: string;
}

export interface AppData {
  version: number;
  passcode: string;
  classInfo: ClassInfo;
  students: Student[];
  fees: Fee[];
  payments: Payment[];
  cashbook: CashbookEntry[];
  updatedAt: string;
}

export type Screen =
  | 'HOME'
  | 'SO_THU_FEES'
  | 'SO_THU_STUDENTS'
  | 'STUDENT_DETAIL'
  | 'SO_NOP_CHI'
  | 'SETTINGS'
  | 'SETTINGS_STUDENTS'
  | 'SETTINGS_GOOGLE_SHEETS'
  | 'SETTINGS_PUBLISH';
