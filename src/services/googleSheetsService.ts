/**
 * Dịch vụ tích hợp Google Sheets qua Google Apps Script (GAS)
 * Không phụ thuộc vào Firebase.
 */

import { AppData } from '../types.ts';

// Mã Google Apps Script hoàn chỉnh để người dùng dán vào Google Sheet
export const GAS_SCRIPT_CODE = `/**
 * ====================================================================
 * CODE GOOGLE APPS SCRIPT CHO "SỔ THU NỘP" - QUỸ LỚP HỌC
 * Hướng dẫn 4 bước đơn giản:
 * 1. Mở Google Sheet mới (sheet.new) hoặc Google Sheet có sẵn.
 * 2. Vào Tiện ích mở rộng (Extensions) -> Apps Script.
 * 3. Xoá hết code cũ, dán toàn bộ đoạn mã này vào -> Bấm Lưu (Ctrl+S).
 * 4. Bấm "Triển khai" (Deploy) -> "Tùy chọn triển khai mới" (New deployment):
 *    - Chọn loại: "Ứng dụng web" (Web app).
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me).
 *    - Ai có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone).
 * 5. Bấm "Triển khai" (Cấp quyền nếu Google hỏi) -> Sao chép URL ứng dụng web
 *    (link kết thúc bằng /exec) và dán vào app Sổ Thu Nộp.
 * ====================================================================
 */

function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var rawSheet = ss.getSheetByName("_DATA_RAW");
    if (!rawSheet) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "error",
        message: "Chưa có dữ liệu. Vui lòng bấm 'Đồng bộ lên Google Sheet' từ app trước."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    var jsonStr = rawSheet.getRange(1, 1).getValue();
    var data = JSON.parse(jsonStr);
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      data: data
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var contents = e.postData.contents;
    var data = JSON.parse(contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Lưu bản JSON nguyên vẹn vào tab _DATA_RAW
    var rawSheet = ss.getSheetByName("_DATA_RAW");
    if (!rawSheet) {
      rawSheet = ss.insertSheet("_DATA_RAW");
      rawSheet.hideSheet();
    }
    rawSheet.getRange(1, 1).setValue(contents);

    // 2. Cập nhật Tab TỔNG QUAN
    var summarySheet = getOrCreateSheet(ss, "TỔNG QUAN");
    summarySheet.clear();
    var tongThu = calculateTongThu(data);
    var tongChi = calculateTongChi(data);
    var dangGiu = tongThu - tongChi;

    summarySheet.getRange("A1:B6").setValues([
      ["TÊN LỚP", data.classInfo ? data.classInfo.className : ""],
      ["GIÁO VIÊN", data.classInfo ? data.classInfo.teacherName : ""],
      ["TỔNG THU (HS NỘP)", tongThu],
      ["TỔNG CHI & NỘP ĐI", tongChi],
      ["TIỀN ĐANG GIỮ", dangGiu],
      ["CẬP NHẬT LÚC", new Date().toLocaleString("vi-VN")]
    ]);
    summarySheet.getRange("A1:A6").setFontWeight("bold").setBackground("#f1f5f9");
    summarySheet.setColumnWidth(1, 200);
    summarySheet.setColumnWidth(2, 250);

    // 3. Cập nhật Tab HỌC SINH
    var stuSheet = getOrCreateSheet(ss, "HỌC SINH");
    stuSheet.clear();
    var stuHeaders = ["STT", "Mã HS", "Họ và tên", "Cần nộp", "Đã nộp", "Còn lại (Nợ/Dư)"];
    var stuRows = [stuHeaders];
    var studentMap = {};

    if (data.students && data.students.length > 0) {
      for (var i = 0; i < data.students.length; i++) {
        var s = data.students[i];
        studentMap[s.id] = s.name;
        var canNop = 0;
        if (data.fees) {
          for (var f = 0; f < data.fees.length; f++) {
            var fee = data.fees[f];
            if (!fee.exemptStudentIds || fee.exemptStudentIds.indexOf(s.id) === -1) {
              canNop += (fee.amount || 0);
            }
          }
        }
        var daNop = 0;
        if (data.payments) {
          for (var p = 0; p < data.payments.length; p++) {
            if (data.payments[p].studentId === s.id) {
              daNop += (data.payments[p].amount || 0);
            }
          }
        }
        var conLai = daNop - canNop;
        stuRows.push([i + 1, s.id, s.name, canNop, daNop, conLai]);
      }
    }
    if (stuRows.length > 0) {
      stuSheet.getRange(1, 1, stuRows.length, stuHeaders.length).setValues(stuRows);
      stuSheet.getRange(1, 1, 1, stuHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");
    }

    // 4. Cập nhật Tab KHOẢN THU
    var feeSheet = getOrCreateSheet(ss, "KHOẢN THU");
    feeSheet.clear();
    var feeHeaders = ["Mã khoản", "Tên khoản thu", "Số tiền (VNĐ)", "Số HS miễn", "Ngày tạo"];
    var feeRows = [feeHeaders];
    if (data.fees && data.fees.length > 0) {
      for (var f = 0; f < data.fees.length; f++) {
        var fee = data.fees[f];
        feeRows.push([
          fee.id,
          fee.name,
          fee.amount,
          (fee.exemptStudentIds ? fee.exemptStudentIds.length : 0),
          fee.createdAt || ""
        ]);
      }
    }
    feeSheet.getRange(1, 1, feeRows.length, feeHeaders.length).setValues(feeRows);
    feeSheet.getRange(1, 1, 1, feeHeaders.length).setFontWeight("bold").setBackground("#e2e8f0");

    // 5. Cập nhật Tab LỊCH SỬ THU TIỀN
    var paySheet = getOrCreateSheet(ss, "LỊCH SỬ THU TIỀN");
    paySheet.clear();
    var payHeaders = ["Ngày nộp", "Họ tên học sinh", "Số tiền (VNĐ)", "Ghi chú"];
    var payRows = [payHeaders];
    if (data.payments && data.payments.length > 0) {
      for (var p = 0; p < data.payments.length; p++) {
        var pay = data.payments[p];
        payRows.push([
          pay.date,
          studentMap[pay.studentId] || pay.studentId,
          pay.amount,
          pay.note || ""
        ]);
      }
    }
    paySheet.getRange(1, 1, payRows.length, payHeaders.length).setValues(payRows);
    paySheet.getRange(1, 1, 1, payHeaders.length).setFontWeight("bold").setBackground("#dcfce7");

    // 6. Cập nhật Tab SỔ NỘP & CHI
    var cashSheet = getOrCreateSheet(ss, "SỔ NỘP & CHI");
    cashSheet.clear();
    var cashHeaders = ["Ngày", "Loại phiếu", "Khoản mục", "Số tiền (VNĐ)", "Người nhận / Người chi", "Ghi chú"];
    var cashRows = [cashHeaders];
    if (data.cashbook && data.cashbook.length > 0) {
      for (var c = 0; c < data.cashbook.length; c++) {
        var cb = data.cashbook[c];
        cashRows.push([
          cb.date,
          cb.type === "nop" ? "NỘP TIỀN" : "CHI TIỀN",
          cb.category,
          cb.amount,
          cb.person,
          cb.note || ""
        ]);
      }
    }
    cashSheet.getRange(1, 1, cashRows.length, cashHeaders.length).setValues(cashRows);
    cashSheet.getRange(1, 1, 1, cashHeaders.length).setFontWeight("bold").setBackground("#fef3c7");

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "Đồng bộ thành công lên Google Sheet!"
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  return sheet;
}

function calculateTongThu(data) {
  var total = 0;
  if (data.payments) {
    for (var i = 0; i < data.payments.length; i++) {
      total += (data.payments[i].amount || 0);
    }
  }
  return total;
}

function calculateTongChi(data) {
  var total = 0;
  if (data.cashbook) {
    for (var i = 0; i < data.cashbook.length; i++) {
      total += (data.cashbook[i].amount || 0);
    }
  }
  return total;
}
`;

// Gửi dữ liệu lên Google Sheet qua Apps Script Web App
export async function syncToGoogleSheetGas(
  gasUrl: string,
  data: AppData
): Promise<{ success: boolean; message: string }> {
  const cleanUrl = gasUrl.trim();
  if (!cleanUrl.startsWith('https://script.google.com')) {
    return { success: false, message: 'URL Web App phải bắt đầu bằng https://script.google.com/...' };
  }

  try {
    const res = await fetch(cleanUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(data)
    });

    try {
      const json = await res.json();
      if (json.status === 'success') {
        return { success: true, message: json.message || 'Đồng bộ Google Sheet thành công!' };
      }
      return { success: false, message: json.message || 'Lỗi từ Google Apps Script' };
    } catch {
      // Trường hợp Google Apps Script trả redirect thành công
      return { success: true, message: 'Đã gửi dữ liệu lên Google Sheet thành công!' };
    }
  } catch (err: any) {
    // Thử lại với chế độ no-cors để đảm bảo request gửi được kể cả khi trình duyệt chặn CORS header
    try {
      await fetch(cleanUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(data)
      });
      return { success: true, message: 'Đã gửi dữ liệu lên Google Sheet thành công!' };
    } catch (err2: any) {
      return { success: false, message: 'Lỗi kết nối tới URL Google Apps Script: ' + (err.message || '') };
    }
  }
}

// Tải dữ liệu từ Google Sheet qua Apps Script Web App
export async function fetchFromGoogleSheetGas(
  gasUrl: string
): Promise<{ success: boolean; data?: AppData; message: string }> {
  const cleanUrl = gasUrl.trim();
  if (!cleanUrl.startsWith('https://script.google.com')) {
    return { success: false, message: 'URL Web App phải bắt đầu bằng https://script.google.com/...' };
  }

  try {
    const fetchUrl = cleanUrl + (cleanUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    const res = await fetch(fetchUrl);
    const json = await res.json();
    if (json.status === 'success' && json.data) {
      return { success: true, data: json.data, message: 'Đã tải dữ liệu từ Google Sheet thành công!' };
    }
    return { success: false, message: json.message || 'Google Sheet chưa có dữ liệu hợp lệ' };
  } catch (err: any) {
    return { success: false, message: 'Không thể đọc dữ liệu từ Google Apps Script: ' + (err.message || '') };
  }
}
