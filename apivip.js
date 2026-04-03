const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8001;

// ====================== CẤU HÌNH ======================
const POLL_INTERVAL = 5000;
const RETRY_DELAY = 5000;
const MAX_HISTORY = 100;

// Chỉ lấy các bàn từ C01 đến C06
const ALLOWED_TABLES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'];

// ====================== STORE ======================
let allTablesData = {};
let lastResultStrMap = {};

// ====================== HÀM HỖ TRỢ ======================
function decodeUnicode(str) {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });
}

function convertResult(char) {
    const mapping = {
        'B': 'Nhà Cái',
        'P': 'Nhà Con',
        'T': 'Hòa'
    };
    return mapping[char] || char;
}

function analyzePattern(results) {
    const recent = results.slice(0, 10);
    return recent.map(r => {
        if (r === "Nhà Cái") return "C";
        if (r === "Nhà Con") return "N";
        return "H";
    }).join('');
}

function predictNext(results) {
    if (results.length < 5) return "Chưa đủ dữ liệu";
    
    let streak = 1;
    const lastResult = results[0];
    for (let i = 1; i < results.length; i++) {
        if (results[i] === lastResult) streak++;
        else break;
    }
    
    if (streak >= 4) {
        return lastResult === "Nhà Cái" ? "Nhà Con" : "Nhà Cái";
    }
    
    if (streak >= 2) {
        return lastResult;
    }
    
    const last3 = results.slice(0, 3);
    const caiCount = last3.filter(r => r === "Nhà Cái").length;
    const conCount = last3.filter(r => r === "Nhà Con").length;
    
    if (caiCount > conCount) return "Nhà Con";
    if (conCount > caiCount) return "Nhà Cái";
    
    return lastResult === "Nhà Cái" ? "Nhà Con" : "Nhà Cái";
}

// ====================== POLLING API ======================
async function pollBaccaratAPI() {
    const url = `http://36.50.55.230:4568/data/sexy`;
    
    while (true) {
        try {
            const res = await axios.get(url, {
                headers: { "User-Agent": "Node-Proxy/1.0" },
                timeout: 10000
            });
            
            const data = res.data;
            
            if (Array.isArray(data)) {
                for (const table of data) {
                    const tableName = table.table_name;
                    
                    if (!ALLOWED_TABLES.includes(tableName)) {
                        continue;
                    }
                    
                    const resultStr = table.result || "";
                    const goodRoad = table.goodRoad || "";
                    const time = table.time || "";
                    
                    if (!resultStr) continue;
                    
                    // Khởi tạo bàn nếu chưa có
                    if (!allTablesData[tableName]) {
                        allTablesData[tableName] = {
                            ten_ban: tableName,
                            phien_hien_tai: 0,
                            ket_qua_hien_tai: "",
                            lich_su_ket_qua: [],
                            pattern: "",
                            du_doan: "Chưa có",
                            cau: "",
                            cap_nhat_luc: "",
                            chuoi_goc: ""
                        };
                        lastResultStrMap[tableName] = "";
                    }
                    
                    // Kiểm tra chuỗi result thay đổi
                    if (resultStr !== lastResultStrMap[tableName]) {
                        const oldLength = lastResultStrMap[tableName].length;
                        const newLength = resultStr.length;
                        
                        if (newLength > oldLength) {
                            // Lấy các ký tự mới
                            const newChars = resultStr.slice(oldLength);
                            
                            for (let i = 0; i < newChars.length; i++) {
                                const char = newChars[i];
                                const ketQua = convertResult(char);
                                
                                allTablesData[tableName].phien_hien_tai++;
                                allTablesData[tableName].lich_su_ket_qua.unshift(ketQua);
                                
                                // Giới hạn lịch sử
                                if (allTablesData[tableName].lich_su_ket_qua.length > MAX_HISTORY) {
                                    allTablesData[tableName].lich_su_ket_qua.pop();
                                }
                                
                                allTablesData[tableName].ket_qua_hien_tai = ketQua;
                                
                                console.log(`[${tableName}] Phiên #${allTablesData[tableName].phien_hien_tai} | ${char} → ${ketQua}`);
                            }
                            
                            // Cập nhật pattern và dự đoán
                            allTablesData[tableName].pattern = analyzePattern(allTablesData[tableName].lich_su_ket_qua);
                            allTablesData[tableName].du_doan = predictNext(allTablesData[tableName].lich_su_ket_qua);
                            allTablesData[tableName].cau = decodeUnicode(goodRoad);
                            allTablesData[tableName].cap_nhat_luc = time;
                            allTablesData[tableName].chuoi_goc = resultStr;
                            
                            console.log(`✅ ${tableName} - Dự đoán: ${allTablesData[tableName].du_doan}\n`);
                        }
                        
                        lastResultStrMap[tableName] = resultStr;
                    }
                }
            }
            
        } catch (err) {
            console.error("❌ Lỗi API:", err.message);
            await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
        
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

// ====================== ROUTES ======================

// Lấy tất cả bàn
app.get('/api/all-tables', (req, res) => {
    const result = Object.values(allTablesData).map(table => ({
        ten_ban: table.ten_ban,
        phien_hien_tai: table.phien_hien_tai,
        ket_qua_hien_tai: table.ket_qua_hien_tai,
        pattern: table.pattern,
        du_doan: table.du_doan,
        cau: table.cau,
        cap_nhat_luc: table.cap_nhat_luc,
        chuoi_goc: table.chuoi_goc
    }));
    res.json(result);
});

// Lấy chi tiết 1 bàn
app.get('/api/table/:name', (req, res) => {
    const tableName = req.params.name.toUpperCase();
    if (ALLOWED_TABLES.includes(tableName) && allTablesData[tableName]) {
        const table = allTablesData[tableName];
        res.json({
            ten_ban: table.ten_ban,
            phien_hien_tai: table.phien_hien_tai,
            ket_qua_hien_tai: table.ket_qua_hien_tai,
            lich_su: table.lich_su_ket_qua.slice(0, 20),
            pattern: table.pattern,
            du_doan: table.du_doan,
            cau: table.cau,
            cap_nhat_luc: table.cap_nhat_luc,
            chuoi_goc: table.chuoi_goc
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Lấy kết quả bàn
app.get('/api/result/:table', (req, res) => {
    const tableName = req.params.table.toUpperCase();
    if (ALLOWED_TABLES.includes(tableName) && allTablesData[tableName]) {
        const table = allTablesData[tableName];
        res.json({
            ban: table.ten_ban,
            tong_phien: table.phien_hien_tai,
            ket_qua_cuoi: table.ket_qua_hien_tai,
            lich_su: table.lich_su_ket_qua.slice(0, 20),
            pattern: table.pattern,
            du_doan: table.du_doan,
            cau: table.cau,
            cap_nhat: table.cap_nhat_luc
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Dự đoán
app.get('/api/predict/:table', (req, res) => {
    const tableName = req.params.table.toUpperCase();
    if (ALLOWED_TABLES.includes(tableName) && allTablesData[tableName]) {
        const table = allTablesData[tableName];
        res.json({
            ban: table.ten_ban,
            phien_hien_tai: table.phien_hien_tai,
            du_doan_phien_tiep: table.du_doan,
            ket_qua_hien_tai: table.ket_qua_hien_tai,
            pattern: table.pattern,
            cau: table.cau
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Thống kê
app.get('/api/stat', (req, res) => {
    const stats = {};
    for (const name of ALLOWED_TABLES) {
        const table = allTablesData[name];
        if (table) {
            const caiCount = table.lich_su_ket_qua.filter(r => r === "Nhà Cái").length;
            const conCount = table.lich_su_ket_qua.filter(r => r === "Nhà Con").length;
            const hoaCount = table.lich_su_ket_qua.filter(r => r === "Hòa").length;
            const total = table.lich_su_ket_qua.length;
            
            stats[name] = {
                tong_phien: table.phien_hien_tai,
                nha_cai: caiCount,
                nha_con: conCount,
                hoa: hoaCount,
                ti_le_cai: total > 0 ? ((caiCount / total) * 100).toFixed(1) + "%" : "0%",
                ti_le_con: total > 0 ? ((conCount / total) * 100).toFixed(1) + "%" : "0%",
                du_doan_tiep: table.du_doan
            };
        } else {
            stats[name] = {
                tong_phien: 0,
                nha_cai: 0,
                nha_con: 0,
                hoa: 0,
                ti_le_cai: "0%",
                ti_le_con: "0%",
                du_doan_tiep: "Chưa có dữ liệu"
            };
        }
    }
    res.json(stats);
});

// Danh sách bàn
app.get('/api/tables', (req, res) => {
    res.json({
        danh_sach_ban: ALLOWED_TABLES,
        ban_dang_chay: Object.keys(allTablesData)
    });
});

// Root
app.get('/', (req, res) => {
    res.json({
        ten_api: "🎲 API Baccarat - Nhà Cái / Nhà Con",
        mo_ta: "Mỗi ký tự trong chuỗi result là 1 phiên",
        endpoints: {
            tat_ca_ban: "/api/all-tables",
            chi_tiet_ban: "/api/table/:ten",
            ket_qua: "/api/result/:ten",
            du_doan: "/api/predict/:ten",
            thong_ke: "/api/stat",
            danh_sach_ban: "/api/tables"
        },
        cac_ban_ho_tro: ALLOWED_TABLES
    });
});

// ====================== START ======================
console.log("╔════════════════════════════════════════════╗");
console.log("║   🎰 BACCARAT API - NHÀ CÁI / NHÀ CON     ║");
console.log("╚════════════════════════════════════════════╝");
console.log("");
console.log("🚀 Nguồn API: http://36.50.55.230:4568/data/sexy");
console.log("🎯 Chỉ lấy các bàn: C01, C02, C03, C04, C05, C06");
console.log("");

pollBaccaratAPI();

app.listen(PORT, () => {
    console.log(`✅ Server chạy tại http://localhost:${PORT}`);
    console.log("");
    console.log("📊 Các endpoint:");
    console.log("   GET /api/all-tables     - Tất cả bàn");
    console.log("   GET /api/table/C01      - Chi tiết bàn C01");
    console.log("   GET /api/result/C01     - Kết quả bàn C01");
    console.log("   GET /api/predict/C01    - Dự đoán bàn C01");
    console.log("   GET /api/stat           - Thống kê");
    console.log("");
});