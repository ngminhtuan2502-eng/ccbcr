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

// ====================== MARKOV CHAIN CLASS ======================
class MarkovChain {
    constructor(order = 2) {
        this.order = order; // Bậc của Markov Chain (mặc định 2)
        this.transitions = new Map(); // Lưu ma trận chuyển tiếp
        this.states = new Set(); // Các trạng thái có thể có
    }

    // Chuyển kết quả thành trạng thái
    resultToState(result) {
        if (result === "Nhà Cái") return "C";
        if (result === "Nhà Con") return "N";
        return "T"; // Hòa
    }

    // Lấy chuỗi trạng thái từ lịch sử
    getStateSequence(history) {
        return history.map(r => this.resultToState(r));
    }

    // Tạo key cho n-gram
    getKey(sequence) {
        return sequence.join('');
    }

    // Huấn luyện Markov Chain từ lịch sử
    train(history) {
        const states = this.getStateSequence(history);
        
        if (states.length < this.order + 1) return;
        
        for (let i = 0; i < states.length - this.order; i++) {
            const currentState = states.slice(i, i + this.order);
            const nextState = states[i + this.order];
            
            const key = this.getKey(currentState);
            
            if (!this.transitions.has(key)) {
                this.transitions.set(key, new Map());
            }
            
            const nextMap = this.transitions.get(key);
            nextMap.set(nextState, (nextMap.get(nextState) || 0) + 1);
            
            this.states.add(nextState);
        }
    }

    // Dự đoán kết quả tiếp theo dựa trên lịch sử gần nhất
    predict(history) {
        const states = this.getStateSequence(history);
        
        if (states.length < this.order) {
            return { prediction: "Chưa đủ dữ liệu", confidence: 0, probabilities: {} };
        }
        
        const lastN = states.slice(-this.order);
        const key = this.getKey(lastN);
        
        if (!this.transitions.has(key)) {
            return { prediction: "Không đủ mẫu", confidence: 0, probabilities: {} };
        }
        
        const nextMap = this.transitions.get(key);
        let total = 0;
        const probs = {};
        
        // Tính tổng số lần xuất hiện
        for (const count of nextMap.values()) {
            total += count;
        }
        
        // Tính xác suất cho từng trạng thái
        for (const [state, count] of nextMap.entries()) {
            const prob = count / total;
            probs[state] = prob;
        }
        
        // Tìm dự đoán có xác suất cao nhất
        let bestState = null;
        let bestProb = 0;
        for (const [state, prob] of Object.entries(probs)) {
            if (prob > bestProb) {
                bestProb = prob;
                bestState = state;
            }
        }
        
        // Chuyển đổi trạng thái về kết quả
        const prediction = bestState === "C" ? "Nhà Cái" : (bestState === "N" ? "Nhà Con" : "Hòa");
        
        return {
            prediction: prediction,
            confidence: (bestProb * 100).toFixed(1) + "%",
            probabilities: {
                nha_cai: (probs["C"] || 0) * 100,
                nha_con: (probs["N"] || 0) * 100,
                hoa: (probs["T"] || 0) * 100
            },
            last_pattern: key,
            order: this.order
        };
    }

    // Reset model
    reset() {
        this.transitions.clear();
        this.states.clear();
    }
}

// ====================== DICE CLASS (Xúc xắc) ======================
class DiceAnalyzer {
    constructor() {
        this.rolls = [];
        this.maxHistory = 100;
    }

    // Thêm kết quả xúc xắc (giả lập từ kết quả Baccarat)
    addRoll(result) {
        // Chuyển kết quả Baccarat thành số xúc xắc 1-6
        let rollValue;
        if (result === "Nhà Cái") rollValue = 1 + Math.floor(Math.random() * 3); // 1-3
        else if (result === "Nhà Con") rollValue = 4 + Math.floor(Math.random() * 3); // 4-6
        else rollValue = Math.floor(Math.random() * 6) + 1; // 1-6 cho Hòa
        
        this.rolls.unshift(rollValue);
        if (this.rolls.length > this.maxHistory) {
            this.rolls.pop();
        }
        return rollValue;
    }

    // Thống kê tần suất
    getStatistics() {
        const stats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        for (const roll of this.rolls) {
            stats[roll]++;
        }
        const total = this.rolls.length;
        
        const percentages = {};
        for (let i = 1; i <= 6; i++) {
            percentages[i] = total > 0 ? ((stats[i] / total) * 100).toFixed(1) + "%" : "0%";
        }
        
        return {
            total_rolls: total,
            counts: stats,
            percentages: percentages,
            most_frequent: this.getMostFrequent(),
            recent_rolls: this.rolls.slice(0, 10)
        };
    }

    // Tìm số xuất hiện nhiều nhất
    getMostFrequent() {
        if (this.rolls.length === 0) return null;
        const counts = {};
        for (const roll of this.rolls) {
            counts[roll] = (counts[roll] || 0) + 1;
        }
        let maxNum = null;
        let maxCount = 0;
        for (const [num, count] of Object.entries(counts)) {
            if (count > maxCount) {
                maxCount = count;
                maxNum = parseInt(num);
            }
        }
        return { number: maxNum, count: maxCount };
    }

    // Dự đoán số tiếp theo (dựa trên xu hướng)
    predictNext() {
        if (this.rolls.length < 3) {
            return { prediction: "Chưa đủ dữ liệu", confidence: 0 };
        }
        
        // Phân tích pattern đơn giản
        const last3 = this.rolls.slice(0, 3);
        const last2 = this.rolls.slice(0, 2);
        
        // Kiểm tra cầu
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            // 3 lần liên tiếp cùng số
            return { 
                prediction: last3[0], 
                confidence: 70,
                reason: "Cầu 3 tay cùng số"
            };
        }
        
        if (last2[0] === last2[1]) {
            // 2 lần liên tiếp
            return { 
                prediction: last2[0], 
                confidence: 60,
                reason: "Cầu 2 tay cùng số"
            };
        }
        
        // Dựa vào số xuất hiện nhiều nhất
        const freq = this.getMostFrequent();
        if (freq && freq.count >= 3) {
            return {
                prediction: freq.number,
                confidence: 55,
                reason: `Số ${freq.number} xuất hiện nhiều nhất (${freq.count} lần)`
            };
        }
        
        // Mặc định: random trong khoảng phổ biến
        const commonNumbers = [3, 4];
        return {
            prediction: commonNumbers[Math.floor(Math.random() * commonNumbers.length)],
            confidence: 40,
            reason: "Không có pattern rõ ràng"
        };
    }
}

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
                            chuoi_goc: "",
                            // Thêm Markov Chain và Dice cho mỗi bàn
                            markovChain: new MarkovChain(2),
                            diceAnalyzer: new DiceAnalyzer(),
                            markovPrediction: {},
                            diceStats: {}
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
                                
                                // Huấn luyện Markov Chain với kết quả mới
                                allTablesData[tableName].markovChain.train(
                                    allTablesData[tableName].lich_su_ket_qua
                                );
                                
                                // Thêm vào Dice Analyzer
                                allTablesData[tableName].diceAnalyzer.addRoll(ketQua);
                                
                                // Giới hạn lịch sử
                                if (allTablesData[tableName].lich_su_ket_qua.length > MAX_HISTORY) {
                                    allTablesData[tableName].lich_su_ket_qua.pop();
                                }
                                
                                allTablesData[tableName].ket_qua_hien_tai = ketQua;
                                
                                console.log(`[${tableName}] Phiên #${allTablesData[tableName].phien_hien_tai} | ${char} → ${ketQua}`);
                            }
                            
                            // Cập nhật pattern và dự đoán thông thường
                            allTablesData[tableName].pattern = analyzePattern(allTablesData[tableName].lich_su_ket_qua);
                            allTablesData[tableName].du_doan = predictNext(allTablesData[tableName].lich_su_ket_qua);
                            
                            // Dự đoán bằng Markov Chain
                            allTablesData[tableName].markovPrediction = allTablesData[tableName].markovChain.predict(
                                allTablesData[tableName].lich_su_ket_qua
                            );
                            
                            // Thống kê Dice
                            allTablesData[tableName].diceStats = allTablesData[tableName].diceAnalyzer.getStatistics();
                            
                            allTablesData[tableName].cau = decodeUnicode(goodRoad);
                            allTablesData[tableName].cap_nhat_luc = time;
                            allTablesData[tableName].chuoi_goc = resultStr;
                            
                            console.log(`✅ ${tableName} - Dự đoán thường: ${allTablesData[tableName].du_doan}`);
                            console.log(`🤖 ${tableName} - Markov: ${allTablesData[tableName].markovPrediction.prediction} (độ tin cậy: ${allTablesData[tableName].markovPrediction.confidence})`);
                            console.log(`🎲 ${tableName} - Dice: ${allTablesData[tableName].diceAnalyzer.predictNext().prediction}\n`);
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
        du_doan_markov: table.markovPrediction,
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
            du_doan_markov: table.markovPrediction,
            thong_ke_dice: table.diceStats,
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
            du_doan_markov: table.markovPrediction,
            cau: table.cau,
            cap_nhat: table.cap_nhat_luc
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Dự đoán (kết hợp cả 3 phương pháp)
app.get('/api/predict/:table', (req, res) => {
    const tableName = req.params.table.toUpperCase();
    if (ALLOWED_TABLES.includes(tableName) && allTablesData[tableName]) {
        const table = allTablesData[tableName];
        const dicePredict = table.diceAnalyzer.predictNext();
        
        res.json({
            ban: table.ten_ban,
            phien_hien_tai: table.phien_hien_tai,
            ket_qua_hien_tai: table.ket_qua_hien_tai,
            du_doan_thuong: {
                phuong_phap: "Phân tích cầu truyền thống",
                du_doan: table.du_doan,
                do_tin_cay: "50%"
            },
            du_doan_markov: {
                phuong_phap: `Markov Chain bậc ${table.markovPrediction.order}`,
                du_doan: table.markovPrediction.prediction,
                do_tin_cay: table.markovPrediction.confidence,
                xac_suat: table.markovPrediction.probabilities,
                mau_hien_tai: table.markovPrediction.last_pattern
            },
            du_doan_dice: {
                phuong_phap: "Phân tích xúc xắc",
                du_doan: `Số ${dicePredict.prediction}`,
                do_tin_cay: `${dicePredict.confidence}%`,
                ly_do: dicePredict.reason
            },
            pattern: table.pattern,
            cau: table.cau,
            thong_ke_dice: table.diceStats
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Dự đoán chuyên sâu Markov
app.get('/api/predict/markov/:table', (req, res) => {
    const tableName = req.params.table.toUpperCase();
    if (ALLOWED_TABLES.includes(tableName) && allTablesData[tableName]) {
        const table = allTablesData[tableName];
        res.json({
            ban: table.ten_ban,
            markov_chain: {
                order: table.markovPrediction.order,
                prediction: table.markovPrediction.prediction,
                confidence: table.markovPrediction.confidence,
                probabilities: table.markovPrediction.probabilities,
                current_pattern: table.markovPrediction.last_pattern
            },
            lich_su_gan_day: table.lich_su_ket_qua.slice(0, 10)
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Thống kê Dice
app.get('/api/dice/:table', (req, res) => {
    const tableName = req.params.table.toUpperCase();
    if (ALLOWED_TABLES.includes(tableName) && allTablesData[tableName]) {
        const table = allTablesData[tableName];
        res.json({
            ban: table.ten_ban,
            thong_ke_xuc_xac: table.diceStats,
            du_doan_tiep: table.diceAnalyzer.predictNext()
        });
    } else {
        res.status(404).json({ loi: `Không tìm thấy bàn ${tableName}` });
    }
});

// Thống kê tổng hợp
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
                du_doan_thuong: table.du_doan,
                du_doan_markov: table.markovPrediction.prediction,
                do_tin_cay_markov: table.markovPrediction.confidence
            };
        } else {
            stats[name] = {
                tong_phien: 0,
                nha_cai: 0,
                nha_con: 0,
                hoa: 0,
                ti_le_cai: "0%",
                ti_le_con: "0%",
                du_doan_thuong: "Chưa có dữ liệu",
                du_doan_markov: "Chưa có",
                do_tin_cay_markov: "0%"
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
        ten_api: "🎲 API Baccarat - Nhà Cái / Nhà Con với Markov Chain & Dice",
        mo_ta: "Mỗi ký tự trong chuỗi result là 1 phiên",
        phuong_phap_du_doan: [
            "1. Phân tích cầu truyền thống (streak, pattern)",
            "2. Markov Chain (xác suất chuyển tiếp trạng thái)",
            "3. Phân tích xúc xắc (tần suất và xu hướng số)"
        ],
        endpoints: {
            tat_ca_ban: "/api/all-tables",
            chi_tiet_ban: "/api/table/:ten",
            ket_qua: "/api/result/:ten",
            du_doan: "/api/predict/:ten",
            du_doan_markov: "/api/predict/markov/:ten",
            thong_ke_dice: "/api/dice/:ten",
            thong_ke: "/api/stat",
            danh_sach_ban: "/api/tables"
        },
        cac_ban_ho_tro: ALLOWED_TABLES
    });
});

// ====================== START ======================
console.log("╔══════════════════════════════════════════════════════════╗");
console.log("║   🎰 BACCARAT API - NHÀ CÁI / NHÀ CON                    ║");
console.log("║   📊 TÍCH HỢP MARKOV CHAIN & DICE ANALYZER               ║");
console.log("╚══════════════════════════════════════════════════════════╝");
console.log("");
console.log("🚀 Nguồn API: http://36.50.55.230:4568/data/sexy");
console.log("🎯 Chỉ lấy các bàn: C01, C02, C03, C04, C05, C06");
console.log("");
console.log("🧠 Phương pháp dự đoán:");
console.log("   📈 Truyền thống - Phân tích cầu, streak");
console.log("   🔗 Markov Chain - Xác suất chuyển tiếp bậc 2");
console.log("   🎲 Dice - Mô phỏng xúc xắc 6 mặt");
console.log("");

pollBaccaratAPI();

app.listen(PORT, () => {
    console.log(`✅ Server chạy tại http://localhost:${PORT}`);
    console.log("");
    console.log("📊 Các endpoint:");
    console.log("   GET /api/all-tables           - Tất cả bàn");
    console.log("   GET /api/table/C01            - Chi tiết bàn C01");
    console.log("   GET /api/result/C01           - Kết quả bàn C01");
    console.log("   GET /api/predict/C01          - Dự đoán (3 phương pháp)");
    console.log("   GET /api/predict/markov/C01   - Dự đoán Markov Chain");
    console.log("   GET /api/dice/C01             - Thống kê xúc xắc");
    console.log("   GET /api/stat                 - Thống kê tổng hợp");
    console.log("");
});
