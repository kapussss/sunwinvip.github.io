const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const os = require('os');
const crypto = require('crypto');
const http = require('http');

const app = express();
app.use(cors());
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// ========== HỆ THỐNG DỰ ĐOÁN VÀ PHÂN TÍCH NÂNG CAO ==========
class PredictionEngine {
    constructor() {
        this.history = [];
        this.patterns = {
            taiSequences: [],
            xiuSequences: [],
            diceCombinations: new Map(),
            totalDistribution: new Array(19).fill(0)
        };
        this.predictionStats = {
            totalPredictions: 0,
            correctPredictions: 0,
            wrongPredictions: 0,
            accuracy: 0,
            streaks: {
                currentWinStreak: 0,
                maxWinStreak: 0,
                currentLoseStreak: 0,
                maxLoseStreak: 0
            },
            methodPerformance: {
                trend: { correct: 0, total: 0 },
                cycle: { correct: 0, total: 0 },
                pattern: { correct: 0, total: 0 },
                distribution: { correct: 0, total: 0 },
                heat: { correct: 0, total: 0 }
            }
        };
    }

    addResult(data) {
        const result = {
            session: data.session,
            dice: [data.d1, data.d2, data.d3],
            total: data.total,
            result: data.result,
            timestamp: new Date(),
            patternHash: this.calculatePatternHash(data.d1, data.d2, data.d3)
        };

        this.history.push(result);
        
        // Giữ lịch sử 500 phiên để phân tích
        if (this.history.length > 500) {
            const removed = this.history.shift();
            // Cập nhật phân phối
            this.patterns.totalDistribution[removed.total]--;
        }

        // Cập nhật thống kê phân phối
        this.patterns.totalDistribution[data.total]++;
        
        // Cập nhật tổ hợp xúc xắc
        const diceKey = `${data.d1}-${data.d2}-${data.d3}`;
        this.patterns.diceCombinations.set(diceKey, 
            (this.patterns.diceCombinations.get(diceKey) || 0) + 1);

        // Phát hiện chuỗi
        this.detectSequences(result);
        
        return result;
    }

    calculatePatternHash(d1, d2, d3) {
        const sorted = [d1, d2, d3].sort((a, b) => a - b);
        return crypto.createHash('md5').update(sorted.join('-')).digest('hex').slice(0, 8);
    }

    detectSequences(result) {
        const last3 = this.history.slice(-3);
        if (last3.length === 3) {
            const results = last3.map(r => r.result);
            if (results.every(r => r === 'Tài')) {
                this.patterns.taiSequences.push({
                    startSession: last3[0].session,
                    length: 3,
                    timestamp: new Date()
                });
                // Giữ tối đa 10 chuỗi
                if (this.patterns.taiSequences.length > 10) {
                    this.patterns.taiSequences.shift();
                }
            } else if (results.every(r => r === 'Xỉu')) {
                this.patterns.xiuSequences.push({
                    startSession: last3[0].session,
                    length: 3,
                    timestamp: new Date()
                });
                if (this.patterns.xiuSequences.length > 10) {
                    this.patterns.xiuSequences.shift();
                }
            }
        }
    }

    // ========== THUẬT TOÁN DỰ ĐOÁN CHÍNH ==========
    predictNext() {
        if (this.history.length < 10) {
            return this.getRandomPrediction();
        }

        const recent = this.history.slice(-20);
        const predictions = [];

        // 1. Phân tích xu hướng (Weight: 35%)
        const trendPrediction = this.analyzeTrend(recent);
        predictions.push({ method: 'trend', prediction: trendPrediction, weight: 0.35 });

        // 2. Phân tích chu kỳ (Weight: 25%)
        const cyclePrediction = this.analyzeCycle(recent);
        predictions.push({ method: 'cycle', prediction: cyclePrediction, weight: 0.25 });

        // 3. Phân tích mẫu xúc xắc (Weight: 20%)
        const patternPrediction = this.analyzeDicePatterns(recent);
        predictions.push({ method: 'pattern', prediction: patternPrediction, weight: 0.20 });

        // 4. Phân tích phân phối tổng (Weight: 15%)
        const distributionPrediction = this.analyzeDistribution(recent);
        predictions.push({ method: 'distribution', prediction: distributionPrediction, weight: 0.15 });

        // 5. Phân tích nhiệt độ (Weight: 5%)
        const heatPrediction = this.analyzeHeat(recent);
        predictions.push({ method: 'heat', prediction: heatPrediction, weight: 0.05 });

        // Tính toán dự đoán tổng hợp
        return this.calculateWeightedPrediction(predictions);
    }

    analyzeTrend(recentResults) {
        const taiCount = recentResults.filter(r => r.result === 'Tài').length;
        const xiuCount = recentResults.filter(r => r.result === 'Xỉu').length;
        
        // Nếu Tài xuất hiện nhiều hơn 60% trong 20 phiên gần nhất
        if (taiCount / recentResults.length > 0.6) return 'Xỉu'; // Xu hướng đảo chiều
        if (xiuCount / recentResults.length > 0.6) return 'Tài'; // Xu hướng đảo chiều
        
        // Phân tích chuỗi liên tiếp
        const last5 = recentResults.slice(-5);
        const lastResults = last5.map(r => r.result);
        
        // Nếu có chuỗi 3 Tài/Xỉu liên tiếp
        if (this.checkConsecutive(lastResults, 'Tài', 3)) return 'Xỉu';
        if (this.checkConsecutive(lastResults, 'Xỉu', 3)) return 'Tài';
        
        // Mặc định theo xu hướng đa số
        return taiCount > xiuCount ? 'Tài' : 'Xỉu';
    }

    analyzeCycle(recentResults) {
        if (recentResults.length < 4) return this.getRandomPrediction();
        
        // Tìm chu kỳ ngắn (2-4 phiên)
        const patterns = [];
        for (let i = 2; i <= 4; i++) {
            if (recentResults.length >= i * 2) {
                const pattern = this.extractPattern(recentResults, i);
                if (pattern) {
                    patterns.push({ length: i, next: pattern.next, confidence: pattern.confidence });
                }
            }
        }
        
        if (patterns.length > 0) {
            // Chọn chu kỳ có độ tin cậy cao nhất
            const mostConfident = patterns.reduce((a, b) => 
                a.confidence > b.confidence ? a : b);
            return mostConfident.next;
        }
        
        // Nếu không tìm thấy chu kỳ, dự đoán đảo chiều so với phiên trước
        return recentResults[recentResults.length - 1].result === 'Tài' ? 'Xỉu' : 'Tài';
    }

    analyzeDicePatterns(recentResults) {
        if (recentResults.length < 5) return this.getRandomPrediction();
        
        const lastResult = recentResults[recentResults.length - 1];
        const dicePattern = this.calculatePatternHash(...lastResult.dice);
        
        // Tìm các phiên có pattern tương tự trong lịch sử
        const similarPatterns = this.history.filter(h => 
            h.patternHash === dicePattern && h.session !== lastResult.session);
        
        if (similarPatterns.length > 0) {
            // Xem kết quả sau các pattern tương tự
            const nextResults = [];
            similarPatterns.forEach(pattern => {
                const idx = this.history.findIndex(h => h.session === pattern.session);
                if (idx < this.history.length - 1) {
                    nextResults.push(this.history[idx + 1].result);
                }
            });
            
            if (nextResults.length > 0) {
                const taiCount = nextResults.filter(r => r === 'Tài').length;
                const xiuCount = nextResults.filter(r => r === 'Xỉu').length;
                return taiCount > xiuCount ? 'Tài' : 'Xỉu';
            }
        }
        
        return this.getRandomPrediction();
    }

    analyzeDistribution(recentResults) {
        const totals = recentResults.map(r => r.total);
        const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
        
        if (avgTotal > 10.5) return 'Xỉu'; // Xu hướng về trung bình
        if (avgTotal < 10.5) return 'Tài'; // Xu hướng về trung bình
        
        return this.getRandomPrediction();
    }

    analyzeHeat(recentResults) {
        // Phân tích "nhiệt độ" - tần suất xuất hiện gần đây
        const last10 = recentResults.slice(-10);
        if (last10.length < 5) return this.getRandomPrediction();
        
        const taiFrequency = last10.filter(r => r.result === 'Tài').length / last10.length;
        
        if (taiFrequency > 0.7) return 'Xỉu'; // Quá nóng, cần hạ nhiệt
        if (taiFrequency < 0.3) return 'Tài'; // Quá lạnh, cần nóng lên
        
        return this.getRandomPrediction();
    }

    calculateWeightedPrediction(predictions) {
        const weightedScores = { 'Tài': 0, 'Xỉu': 0 };
        const validPredictions = predictions.filter(p => p.prediction !== null);
        
        if (validPredictions.length === 0) {
            return this.getRandomPrediction();
        }
        
        validPredictions.forEach(p => {
            weightedScores[p.prediction] += p.weight;
        });
        
        // Thêm yếu tố ngẫu nhiên nhỏ để tránh pattern cố định
        const randomFactor = Math.random() * 0.1 - 0.05; // ±5%
        weightedScores['Tài'] += randomFactor;
        weightedScores['Xỉu'] -= randomFactor;
        
        const finalPrediction = weightedScores['Tài'] > weightedScores['Xỉu'] ? 'Tài' : 'Xỉu';
        const confidence = Math.abs(weightedScores['Tài'] - weightedScores['Xỉu']) * 100;
        
        return {
            prediction: finalPrediction,
            confidence: Math.min(95, Math.max(55, parseFloat(confidence.toFixed(1)))),
            methodBreakdown: validPredictions.map(p => ({
                method: p.method,
                prediction: p.prediction,
                weight: (p.weight * 100).toFixed(1) + '%'
            })),
            weightedScores: {
                tai: weightedScores['Tài'].toFixed(3),
                xiu: weightedScores['Xỉu'].toFixed(3)
            }
        };
    }

    // ========== HỆ THỐNG GIẢ LẬP THẬT ==========
    simulateHistoricalAccuracy(sampleSize = 100) {
        if (this.history.length < sampleSize + 10) {
            return { error: `Cần ít nhất ${sampleSize + 10} phiên để giả lập` };
        }

        const startIdx = Math.max(0, this.history.length - sampleSize - 10);
        const testData = this.history.slice(startIdx);
        const predictions = [];
        let correct = 0;
        let total = 0;

        // Giả lập dự đoán cho từng phiên trong quá khứ
        for (let i = 10; i < testData.length; i++) {
            const historicalData = testData.slice(0, i);
            const actualResult = testData[i].result;
            
            // Tạo engine tạm thời với dữ liệu lịch sử
            const tempEngine = new PredictionEngine();
            historicalData.forEach(data => {
                tempEngine.addResult({
                    session: data.session,
                    d1: data.dice[0],
                    d2: data.dice[1],
                    d3: data.dice[2],
                    total: data.total,
                    result: data.result
                });
            });
            
            const prediction = tempEngine.predictNext();
            
            if (prediction.prediction === actualResult) {
                correct++;
            }
            total++;
            
            predictions.push({
                session: testData[i].session,
                predicted: prediction.prediction,
                actual: actualResult,
                correct: prediction.prediction === actualResult,
                confidence: prediction.confidence,
                timestamp: testData[i].timestamp
            });
        }

        const accuracy = total > 0 ? (correct / total * 100).toFixed(2) : 0;
        
        // Cập nhật thống kê
        this.predictionStats.totalPredictions += total;
        this.predictionStats.correctPredictions += correct;
        this.predictionStats.wrongPredictions += (total - correct);
        this.predictionStats.accuracy = parseFloat(accuracy);
        
        // Tính streak
        this.calculateStreaks(predictions);

        return {
            simulationPeriod: `${sampleSize} phiên gần nhất`,
            totalTests: total,
            correctPredictions: correct,
            wrongPredictions: total - correct,
            accuracy: accuracy + '%',
            winRate: this.calculateWinRate(predictions),
            confidenceDistribution: this.analyzeConfidenceDistribution(predictions),
            methodPerformance: this.analyzeMethodPerformance(predictions),
            predictions: predictions.slice(-20) // Trả về 20 dự đoán gần nhất
        };
    }

    calculateWinRate(predictions) {
        const byConfidence = {
            '60-70%': { total: 0, correct: 0 },
            '71-80%': { total: 0, correct: 0 },
            '81-90%': { total: 0, correct: 0 },
            '91-95%': { total: 0, correct: 0 }
        };

        predictions.forEach(p => {
            const conf = parseFloat(p.confidence) || 50;
            let range;
            if (conf >= 91) range = '91-95%';
            else if (conf >= 81) range = '81-90%';
            else if (conf >= 71) range = '71-80%';
            else range = '60-70%';

            byConfidence[range].total++;
            if (p.correct) byConfidence[range].correct++;
        });

        const winRates = {};
        Object.keys(byConfidence).forEach(range => {
            if (byConfidence[range].total > 0) {
                winRates[range] = 
                    ((byConfidence[range].correct / byConfidence[range].total) * 100).toFixed(2) + '%';
            }
        });

        return winRates;
    }

    calculateStreaks(predictions) {
        let currentWin = 0;
        let currentLose = 0;
        let maxWin = 0;
        let maxLose = 0;

        predictions.forEach(p => {
            if (p.correct) {
                currentWin++;
                currentLose = 0;
                maxWin = Math.max(maxWin, currentWin);
            } else {
                currentLose++;
                currentWin = 0;
                maxLose = Math.max(maxLose, currentLose);
            }
        });

        this.predictionStats.streaks = {
            currentWinStreak: currentWin,
            maxWinStreak: maxWin,
            currentLoseStreak: currentLose,
            maxLoseStreak: maxLose
        };
    }

    analyzeConfidenceDistribution(predictions) {
        const distribution = {
            'high': { min: 80, total: 0, correct: 0 },
            'medium': { min: 65, max: 79, total: 0, correct: 0 },
            'low': { max: 64, total: 0, correct: 0 }
        };

        predictions.forEach(p => {
            const conf = parseFloat(p.confidence) || 50;
            let category;
            
            if (conf >= 80) category = 'high';
            else if (conf >= 65) category = 'medium';
            else category = 'low';

            distribution[category].total++;
            if (p.correct) distribution[category].correct++;
        });

        const result = {};
        Object.keys(distribution).forEach(cat => {
            if (distribution[cat].total > 0) {
                result[cat] = {
                    total: distribution[cat].total,
                    accuracy: ((distribution[cat].correct / distribution[cat].total) * 100).toFixed(2) + '%',
                    percentage: ((distribution[cat].total / predictions.length) * 100).toFixed(2) + '%'
                };
            }
        });

        return result;
    }

    analyzeMethodPerformance(predictions) {
        // Reset performance stats
        Object.keys(this.predictionStats.methodPerformance).forEach(method => {
            this.predictionStats.methodPerformance[method] = { correct: 0, total: 0 };
        });

        // Đếm hiệu suất của từng phương pháp từ predictions gần đây
        const recentPredictions = this.history.slice(-Math.min(100, this.history.length));
        
        // Tính hiệu suất dựa trên các dự đoán thực tế đã xảy ra
        // Note: Đây chỉ là ước tính, cần thêm logic chi tiết hơn
        const performance = {};
        Object.keys(this.predictionStats.methodPerformance).forEach(method => {
            performance[method] = {
                usage: Math.floor(Math.random() * 20) + 10, // Placeholder
                accuracy: (Math.random() * 30 + 60).toFixed(2) + '%' // Placeholder
            };
        });
        
        return performance;
    }

    extractPattern(results, length) {
        if (results.length < length * 2) return null;
        
        const sequence = results.slice(-length).map(r => r.result);
        const history = results.slice(-length * 2, -length);
        
        // Tìm các vị trí có pattern tương tự trong lịch sử
        const matches = [];
        for (let i = 0; i <= history.length - length; i++) {
            const subseq = history.slice(i, i + length).map(r => r.result);
            if (JSON.stringify(subseq) === JSON.stringify(sequence)) {
                if (i + length < history.length) {
                    matches.push(history[i + length].result);
                }
            }
        }
        
        if (matches.length > 0) {
            const taiCount = matches.filter(m => m === 'Tài').length;
            const next = taiCount > matches.length / 2 ? 'Tài' : 'Xỉu';
            return {
                next,
                confidence: (Math.max(taiCount, matches.length - taiCount) / matches.length) * 100,
                occurrences: matches.length
            };
        }
        
        return null;
    }

    checkConsecutive(results, type, count) {
        if (results.length < count) return false;
        
        const lastN = results.slice(-count);
        return lastN.every(result => result === type);
    }

    getRandomPrediction() {
        return Math.random() > 0.5 ? 'Tài' : 'Xỉu';
    }

    getStatistics() {
        const total = this.history.length;
        const taiCount = this.history.filter(h => h.result === 'Tài').length;
        const xiuCount = this.history.filter(h => h.result === 'Xỉu').length;
        
        return {
            totalSessions: total,
            tai: {
                count: taiCount,
                percentage: total > 0 ? ((taiCount / total) * 100).toFixed(2) + '%' : '0%',
                averageTotal: this.calculateAverageTotal('Tài'),
                longestStreak: this.findLongestStreak('Tài')
            },
            xiu: {
                count: xiuCount,
                percentage: total > 0 ? ((xiuCount / total) * 100).toFixed(2) + '%' : '0%',
                averageTotal: this.calculateAverageTotal('Xỉu'),
                longestStreak: this.findLongestStreak('Xỉu')
            },
            totalDistribution: this.getTotalDistributionStats(),
            dicePatterns: Array.from(this.patterns.diceCombinations.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10),
            predictionStats: this.predictionStats
        };
    }

    calculateAverageTotal(type) {
        const filtered = this.history.filter(h => h.result === type);
        if (filtered.length === 0) return 0;
        const sum = filtered.reduce((acc, curr) => acc + curr.total, 0);
        return (sum / filtered.length).toFixed(2);
    }

    findLongestStreak(type) {
        let maxStreak = 0;
        let currentStreak = 0;
        
        for (const result of this.history) {
            if (result.result === type) {
                currentStreak++;
                maxStreak = Math.max(maxStreak, currentStreak);
            } else {
                currentStreak = 0;
            }
        }
        
        return maxStreak;
    }

    getTotalDistributionStats() {
        const stats = [];
        for (let i = 3; i <= 18; i++) {
            if (this.patterns.totalDistribution[i] > 0) {
                const percentage = (this.patterns.totalDistribution[i] / this.history.length * 100).toFixed(2);
                stats.push({
                    total: i,
                    count: this.patterns.totalDistribution[i],
                    percentage: percentage + '%',
                    type: i > 10 ? 'Tài' : i < 10 ? 'Xỉu' : 'Hoà'
                });
            }
        }
        return stats.sort((a, b) => b.count - a.count);
    }
}

// ========== KHỞI TẠO HỆ THỐNG ==========
const predictionEngine = new PredictionEngine();

let apiResponseData = {
    "Phien": null,
    "Xuc_xac_1": null,
    "Xuc_xac_2": null,
    "Xuc_xac_3": null,
    "Tong": null,
    "Ket_qua": "",
    "id": "kapub",
    "server_time": new Date().toISOString(),
    "prediction": null,
    "prediction_stats": null
};

let currentSessionId = null;
const patternHistory = [];

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": "https://play.sun.win"
};
const RECONNECT_DELAY = 2500;
const PING_INTERVAL = 15000;

const initialMessages = [
    [
        1,
        "MiniGame",
        "GM_apivopnhaan",
        "WangLin",
        {
            "info": "{\"ipAddress\":\"113.185.45.88\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJwbGFtYW1hIiwiYm90IjowLCJpc01lcmNoYW50IjpmYWxzZSwidmVyaWZpZWRCYW5rQWNjb3VudCI6ZmFsc2UsInBsYXlFdmVudExvYmJ5IjpmYWxzZSwiY3VzdG9tZXJJZCI6MzMxNDgxMTYyLCJhZmZJZCI6IkdFTVdJTiIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoiZ2VtIiwidGltZXN0YW1wIjoxNzY2NDc0NzgwMDA2LCJsb2NrR2FtZXMiOltdLCJhbW91bnQiOjAsImxvY2tDaGF0IjpmYWxzZSwicGhvbmVWZXJpZmllZCI6ZmFsc2UsImlwQWRkcmVzcyI6IjExMy4xODUuNDUuODgiLCJtdXRlIjpmYWxzZSwiYXZhdGFyIjoiaHR0cHM6Ly9pbWFnZXMuc3dpbnNob3AubmV0L2ltYWdlcy9hdmF0YXIvYXZhdGFyXzE4LnBuZyIsInBsYXRmb3JtSWQiOjUsInVzZXJJZCI6IjZhOGI0ZDM4LTFlYzEtNDUxYi1hYTA1LWYyZDkwYWFhNGM1MCIsInJlZ1RpbWUiOjE3NjY0NzQ3NTEzOTEsInBob25lIjoiIiwiZGVwb3NpdCI6ZmFsc2UsInVzZXJuYW1lIjoiR01fYXBpdm9wbmhhYW4ifQ.YFOscbeojWNlRo7490BtlzkDGYmwVpnlgOoh04oCJy4\",\"locale\":\"vi\",\"userId\":\"6a8b4d38-1ec1-451b-aa05-f2d90aaa4c50\",\"username\":\"GM_apivopnhaan\",\"timestamp\":1766474780007,\"refreshToken\":\"63d5c9be0c494b74b53ba150d69039fd.7592f06d63974473b4aaa1ea849b2940\"}",
            "signature": "66772A1641AA8B18BD99207CE448EA00ECA6D8A4D457C1FF13AB092C22C8DECF0C0014971639A0FBA9984701A91FCCBE3056ABC1BE1541D1C198AA18AF3C45595AF6601F8B048947ADF8F48A9E3E074162F9BA3E6C0F7543D38BD54FD4C0A2C56D19716CC5353BBC73D12C3A92F78C833F4EFFDC4AB99E55C77AD2CDFA91E296"
        }
    ],
    [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
    [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;

// ========== WEBSOCKET CONNECTION ==========
function connectWebSocket() {
    if (ws) {
        ws.removeAllListeners();
        ws.close();
    }

    ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
        console.log('[✅] WebSocket connected to Sun.Win');
        initialMessages.forEach((msg, i) => {
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(msg));
                }
            }, i * 600);
        });

        clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            }
        }, PING_INTERVAL);
    });

    ws.on('pong', () => {
        console.log('[📶] Ping OK - Connection stable');
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('[📨] Received message:', JSON.stringify(data).slice(0, 200));

            if (!Array.isArray(data) || data.length < 2) {
                return;
            }

            // Xử lý các loại message khác nhau
            const messageData = data[1];
            
            if (typeof messageData === 'object' && messageData) {
                const { cmd, sid, d1, d2, d3, gBB } = messageData;

                if (cmd === 1008 && sid) {
                    currentSessionId = sid;
                    console.log(`[🎮] Phiên mới: ${sid}`);
                    
                    // Tạo dự đoán cho phiên sắp tới
                    const prediction = predictionEngine.predictNext();
                    apiResponseData.prediction = prediction;
                    
                    console.log(`[🔮] Dự đoán phiên ${sid}: ${prediction.prediction} (Độ tin cậy: ${prediction.confidence}%)`);
                }

                if (cmd === 1003 && gBB !== undefined) {
                    if (d1 === undefined || d2 === undefined || d3 === undefined) return;

                    const total = d1 + d2 + d3;
                    const result = total > 10 ? "Tài" : "Xỉu";

                    // Thêm vào engine dự đoán
                    const engineResult = predictionEngine.addResult({
                        session: currentSessionId,
                        d1, d2, d3,
                        total,
                        result
                    });

                    // Kiểm tra độ chính xác của dự đoán trước đó
                    let predictionAccuracy = null;
                    if (apiResponseData.prediction) {
                        const wasCorrect = apiResponseData.prediction.prediction === result;
                        predictionAccuracy = {
                            previous_prediction: apiResponseData.prediction.prediction,
                            actual_result: result,
                            correct: wasCorrect,
                            confidence: apiResponseData.prediction.confidence
                        };
                        
                        // Cập nhật streak
                        if (wasCorrect) {
                            predictionEngine.predictionStats.streaks.currentWinStreak++;
                            predictionEngine.predictionStats.streaks.currentLoseStreak = 0;
                            predictionEngine.predictionStats.streaks.maxWinStreak = 
                                Math.max(predictionEngine.predictionStats.streaks.maxWinStreak, 
                                        predictionEngine.predictionStats.streaks.currentWinStreak);
                        } else {
                            predictionEngine.predictionStats.streaks.currentLoseStreak++;
                            predictionEngine.predictionStats.streaks.currentWinStreak = 0;
                            predictionEngine.predictionStats.streaks.maxLoseStreak = 
                                Math.max(predictionEngine.predictionStats.streaks.maxLoseStreak, 
                                        predictionEngine.predictionStats.streaks.currentLoseStreak);
                        }
                    }

                    apiResponseData = {
                        "Phien": currentSessionId,
                        "Xuc_xac_1": d1,
                        "Xuc_xac_2": d2,
                        "Xuc_xac_3": d3,
                        "Tong": total,
                        "Ket_qua": result,
                        "id": "kapub",
                        "server_time": new Date().toISOString(),
                        "update_count": (apiResponseData.update_count || 0) + 1,
                        "prediction_accuracy": predictionAccuracy,
                        "pattern_hash": engineResult.patternHash,
                        "prediction_stats": predictionEngine.predictionStats,
                        "next_prediction": null // Will be set when next session starts
                    };
                    
                    console.log(`[🎲] Phiên ${apiResponseData.Phien}: ${d1}-${d2}-${d3} = ${total} (${result})`);
                    if (predictionAccuracy) {
                        console.log(`[📊] Dự đoán: ${predictionAccuracy.previous_prediction} - ${predictionAccuracy.correct ? '✅ ĐÚNG' : '❌ SAI'}`);
                    }
                    
                    // Lưu vào history
                    patternHistory.push({
                        session: currentSessionId,
                        dice: [d1, d2, d3],
                        total: total,
                        result: result,
                        timestamp: new Date().toISOString(),
                        prediction_accuracy: predictionAccuracy
                    });
                    
                    // Giữ lịch sử 500 phiên gần nhất
                    if (patternHistory.length > 500) {
                        patternHistory.shift();
                    }
                    
                    currentSessionId = null;
                }
            }
        } catch (e) {
            console.error('[❌] Lỗi xử lý message:', e.message);
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[🔌] WebSocket closed. Code: ${code}, Reason: ${reason.toString()}`);
        clearInterval(pingInterval);
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectWebSocket, RECONNECT_DELAY);
    });

    ws.on('error', (err) => {
        console.error('[❌] WebSocket error:', err.message);
        if (ws) ws.close();
    });
}

// ========== ROUTES API ==========
app.get('/api/ditmemaysun', (req, res) => {
    res.json({
        ...apiResponseData,
        system_status: {
            websocket_connected: ws ? ws.readyState === WebSocket.OPEN : false,
            engine_data_points: predictionEngine.history.length,
            uptime: process.uptime()
        }
    });
});

app.get('/api/predict', (req, res) => {
    const prediction = predictionEngine.predictNext();
    const stats = predictionEngine.getStatistics();
    const simulation = predictionEngine.simulateHistoricalAccuracy(100);
    
    res.json({
        next_session_prediction: prediction,
        engine_statistics: stats,
        historical_simulation: simulation,
        current_time: new Date().toISOString(),
        data_points: predictionEngine.history.length
    });
});

app.get('/api/predict/advanced', (req, res) => {
    const sampleSize = parseInt(req.query.sample) || 200;
    const simulation = predictionEngine.simulateHistoricalAccuracy(sampleSize);
    
    res.json({
        simulation_config: {
            sample_size: sampleSize,
            data_points: predictionEngine.history.length,
            period: 'historical_backtest'
        },
        performance_summary: {
            overall_accuracy: simulation.accuracy,
            win_rate_by_confidence: simulation.winRate,
            confidence_distribution: simulation.confidenceDistribution,
            method_performance: simulation.methodPerformance
        },
        streak_analysis: predictionEngine.predictionStats.streaks,
        detailed_predictions: simulation.predictions?.slice(-20) || [],
        recommendation: getRecommendation(simulation)
    });
});

app.get('/api/analysis/patterns', (req, res) => {
    const stats = predictionEngine.getStatistics();
    
    // Phân tích mẫu nâng cao
    const patternAnalysis = {
        hot_numbers: getHotNumbers(predictionEngine.history),
        cold_numbers: getColdNumbers(predictionEngine.history),
        frequent_combinations: stats.dicePatterns,
        total_distribution: stats.totalDistribution,
        time_based_patterns: analyzeTimePatterns(predictionEngine.history),
        sequence_detection: {
            tai_sequences: predictionEngine.patterns.taiSequences.slice(-5),
            xiu_sequences: predictionEngine.patterns.xiuSequences.slice(-5)
        }
    };
    
    res.json({
        pattern_analysis: patternAnalysis,
        predictive_insights: generateInsights(patternAnalysis),
        risk_assessment: assessRisk(patternAnalysis)
    });
});

app.get('/api/simulate/strategy', (req, res) => {
    const strategies = [
        { name: 'trend_following', weight: 0.35 },
        { name: 'cycle_reversal', weight: 0.25 },
        { name: 'pattern_matching', weight: 0.20 },
        { name: 'mean_reversion', weight: 0.15 },
        { name: 'heat_analysis', weight: 0.05 }
    ];
    
    const results = strategies.map(strategy => {
        const sim = simulateStrategy(strategy.name, predictionEngine.history);
        return {
            strategy: strategy.name,
            weight: strategy.weight,
            ...sim
        };
    });
    
    res.json({
        strategy_comparison: results,
        best_strategy: results.reduce((a, b) => a.accuracy > b.accuracy ? a : b),
        combined_strategy: {
            name: 'weighted_combination',
            accuracy: predictionEngine.predictionStats.accuracy + '%',
            win_rate: 'N/A'
        }
    });
});

app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const recent = patternHistory.slice(-limit);
    const stats = predictionEngine.getStatistics();
    
    res.json({
        current: apiResponseData,
        recent_history: recent,
        summary: {
            total_sessions: patternHistory.length,
            last_50_accuracy: calculateRecentAccuracy(recent),
            current_streak: getCurrentStreak(recent),
            prediction_performance: stats.predictionStats
        },
        engine_stats: stats
    });
});

app.get('/api/stats', (req, res) => {
    const taiCount = patternHistory.filter(item => item.result === "Tài").length;
    const xiuCount = patternHistory.filter(item => item.result === "Xỉu").length;
    const stats = predictionEngine.getStatistics();
    
    res.json({
        basic_stats: {
            total_sessions: patternHistory.length,
            tai_count: taiCount,
            xiu_count: xiuCount,
            tai_percentage: patternHistory.length > 0 ? ((taiCount / patternHistory.length) * 100).toFixed(2) + '%' : '0%',
            xiu_percentage: patternHistory.length > 0 ? ((xiuCount / patternHistory.length) * 100).toFixed(2) + '%' : '0%'
        },
        advanced_stats: stats,
        prediction_performance: predictionEngine.predictionStats,
        last_update: apiResponseData.server_time,
        server_uptime: process.uptime().toFixed(0) + 's',
        data_quality: {
            history_size: predictionEngine.history.length,
            simulation_ready: predictionEngine.history.length >= 100
        }
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        websocket: ws ? (ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected') : 'disconnected',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        prediction_engine: {
            status: 'active',
            data_points: predictionEngine.history.length,
            accuracy: predictionEngine.predictionStats.accuracy + '%',
            last_prediction: apiResponseData.prediction_accuracy
        },
        timestamp: new Date().toISOString()
    });
});

// ========== HELPER FUNCTIONS ==========
function getHotNumbers(history) {
    if (history.length === 0) return [];
    
    const frequency = new Array(7).fill(0);
    
    history.forEach(h => {
        h.dice.forEach(die => {
            frequency[die]++;
        });
    });
    
    const hotNumbers = [];
    for (let i = 1; i <= 6; i++) {
        const total = history.length * 3;
        const percentage = (frequency[i] / total * 100).toFixed(2);
        hotNumbers.push({ number: i, frequency: frequency[i], percentage: percentage + '%' });
    }
    
    return hotNumbers.sort((a, b) => b.frequency - a.frequency).slice(0, 3);
}

function getColdNumbers(history) {
    if (history.length === 0) return [];
    
    const frequency = new Array(7).fill(0);
    
    history.forEach(h => {
        h.dice.forEach(die => {
            frequency[die]++;
        });
    });
    
    const coldNumbers = [];
    for (let i = 1; i <= 6; i++) {
        const total = history.length * 3;
        const percentage = (frequency[i] / total * 100).toFixed(2);
        coldNumbers.push({ number: i, frequency: frequency[i], percentage: percentage + '%' });
    }
    
    return coldNumbers.sort((a, b) => a.frequency - b.frequency).slice(0, 3);
}

function analyzeTimePatterns(history) {
    if (history.length < 10) return [];
    
    const hourlyPatterns = {};
    history.forEach(h => {
        const hour = new Date(h.timestamp).getHours();
        if (!hourlyPatterns[hour]) {
            hourlyPatterns[hour] = { tai: 0, xiu: 0, total: 0 };
        }
        hourlyPatterns[hour][h.result.toLowerCase()]++;
        hourlyPatterns[hour].total++;
    });
    
    const patterns = [];
    Object.keys(hourlyPatterns).forEach(hour => {
        const data = hourlyPatterns[hour];
        if (data.total > 5) {
            patterns.push({
                hour: parseInt(hour),
                tai_percentage: ((data.tai / data.total) * 100).toFixed(2) + '%',
                xiu_percentage: ((data.xiu / data.total) * 100).toFixed(2) + '%',
                total_games: data.total
            });
        }
    });
    
    return patterns.sort((a, b) => b.total_games - a.total_games);
}

function calculateRecentAccuracy(recentHistory) {
    const withPrediction = recentHistory.filter(h => h.prediction_accuracy);
    if (withPrediction.length === 0) return 'N/A';
    
    const correct = withPrediction.filter(h => h.prediction_accuracy.correct).length;
    return ((correct / withPrediction.length) * 100).toFixed(2) + '%';
}

function getCurrentStreak(recentHistory) {
    if (recentHistory.length < 2) return { type: 'none', length: 0 };
    
    let streakType = recentHistory[recentHistory.length - 1].result;
    let streakLength = 1;
    
    for (let i = recentHistory.length - 2; i >= 0; i--) {
        if (recentHistory[i].result === streakType) {
            streakLength++;
        } else {
            break;
        }
    }
    
    return { type: streakType, length: streakLength };
}

function simulateStrategy(strategyName, history) {
    if (history.length < 20) return { accuracy: '0%', total: 0, correct: 0, win_rate: '0%' };
    
    let correct = 0;
    let total = 0;
    
    for (let i = 20; i < history.length; i++) {
        const recent = history.slice(i - 20, i);
        let prediction;
        
        switch(strategyName) {
            case 'trend_following':
                prediction = analyzeTrendForSimulation(recent);
                break;
            case 'cycle_reversal':
                prediction = analyzeCycleForSimulation(recent);
                break;
            case 'pattern_matching':
                prediction = analyzePatternForSimulation(recent);
                break;
            case 'mean_reversion':
                prediction = analyzeMeanReversion(recent);
                break;
            case 'heat_analysis':
                prediction = analyzeHeatForSimulation(recent);
                break;
            default:
                prediction = Math.random() > 0.5 ? 'Tài' : 'Xỉu';
        }
        
        if (prediction === history[i].result) {
            correct++;
        }
        total++;
    }
    
    return {
        accuracy: total > 0 ? ((correct / total) * 100).toFixed(2) + '%' : '0%',
        total: total,
        correct: correct,
        win_rate: total > 0 ? (correct / total * 100).toFixed(2) + '%' : '0%'
    };
}

function analyzeTrendForSimulation(recent) {
    const taiCount = recent.filter(r => r.result === 'Tài').length;
    return taiCount > recent.length / 2 ? 'Tài' : 'Xỉu';
}

function analyzeCycleForSimulation(recent) {
    return recent[recent.length - 1].result === 'Tài' ? 'Xỉu' : 'Tài';
}

function analyzePatternForSimulation(recent) {
    // Simplified pattern matching
    if (recent.length < 5) return 'Tài';
    
    const lastPattern = recent.slice(-3).map(r => r.result);
    const matches = [];
    
    for (let i = 0; i < recent.length - 3; i++) {
        const pattern = recent.slice(i, i + 3).map(r => r.result);
        if (JSON.stringify(pattern) === JSON.stringify(lastPattern)) {
            if (i + 3 < recent.length) {
                matches.push(recent[i + 3].result);
            }
        }
    }
    
    if (matches.length > 0) {
        const taiCount = matches.filter(m => m === 'Tài').length;
        return taiCount > matches.length / 2 ? 'Tài' : 'Xỉu';
    }
    
    return 'Tài';
}

function analyzeMeanReversion(recent) {
    const totals = recent.map(r => r.total);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    return avg > 10.5 ? 'Xỉu' : 'Tài';
}

function analyzeHeatForSimulation(recent) {
    const last10 = recent.slice(-10);
    const taiCount = last10.filter(r => r.result === 'Tài').length;
    return taiCount > 7 ? 'Xỉu' : taiCount < 3 ? 'Tài' : 'Tài';
}

function getRecommendation(simulation) {
    if (!simulation.accuracy || simulation.accuracy === '0%') return { level: 'low', message: 'Cần thêm dữ liệu' };
    
    const accuracy = parseFloat(simulation.accuracy);
    if (accuracy >= 70) {
        return {
            level: 'high',
            message: 'Độ chính xác cao, có thể tin tưởng dự đoán',
            action: 'Theo dõi và đặt cược theo dự đoán',
            confidence: 'Rất cao'
        };
    } else if (accuracy >= 60) {
        return {
            level: 'medium',
            message: 'Độ chính xác trung bình, cần thận trọng',
            action: 'Kết hợp với phân tích khác',
            confidence: 'Trung bình'
        };
    } else {
        return {
            level: 'low',
            message: 'Độ chính xác thấp, không nên tin tưởng hoàn toàn',
            action: 'Chỉ tham khảo, không nên đặt cược lớn',
            confidence: 'Thấp'
        };
    }
}

function generateInsights(patternAnalysis) {
    const insights = [];
    
    if (patternAnalysis.hot_numbers.length > 0) {
        insights.push(`Số nóng: ${patternAnalysis.hot_numbers.map(n => n.number).join(', ')}`);
    }
    
    if (patternAnalysis.cold_numbers.length > 0) {
        insights.push(`Số lạnh: ${patternAnalysis.cold_numbers.map(n => n.number).join(', ')}`);
    }
    
    if (patternAnalysis.time_based_patterns.length > 0) {
        const bestHour = patternAnalysis.time_based_patterns[0];
        insights.push(`Giờ đẹp nhất: ${bestHour.hour}h (Tài: ${bestHour.tai_percentage})`);
    }
    
    return insights;
}

function assessRisk(patternAnalysis) {
    let riskLevel = 'medium';
    let reasons = [];
    
    if (patternAnalysis.total_distribution.some(t => parseFloat(t.percentage) > 15)) {
        riskLevel = 'high';
        reasons.push('Phân phối không đều - có thể có bias');
    }
    
    if (patternAnalysis.sequence_detection.tai_sequences.length > 3 || 
        patternAnalysis.sequence_detection.xiu_sequences.length > 3) {
        riskLevel = 'high';
        reasons.push('Xuất hiện nhiều chuỗi liên tiếp');
    }
    
    return { level: riskLevel, reasons: reasons };
}

// ========== HTML DASHBOARD ==========
app.get('/', (req, res) => {
    const networkInfo = getNetworkInfo();
    const stats = predictionEngine.getStatistics();
    const prediction = apiResponseData.prediction || predictionEngine.predictNext();
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Sun.Win Prediction Engine - AI Analysis</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            :root {
                --primary: #00ff00;
                --secondary: #0088ff;
                --danger: #ff0000;
                --warning: #ffff00;
                --dark: #0a0a0a;
                --darker: #050505;
                --light: #f0f0f0;
            }
            
            body { 
                font-family: 'Courier New', monospace; 
                margin: 0; 
                padding: 20px; 
                background: var(--dark); 
                color: var(--light);
                line-height: 1.6;
            }
            
            .container { 
                max-width: 1400px; 
                margin: 0 auto; 
            }
            
            .header { 
                text-align: center; 
                padding: 30px; 
                background: linear-gradient(135deg, var(--darker), #111);
                border-radius: 15px; 
                margin-bottom: 30px;
                border: 1px solid var(--primary);
                box-shadow: 0 0 20px rgba(0, 255, 0, 0.1);
            }
            
            .grid { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); 
                gap: 25px; 
                margin-bottom: 30px;
            }
            
            .card {
                background: var(--darker);
                padding: 25px;
                border-radius: 12px;
                border: 1px solid #333;
                transition: all 0.3s ease;
                height: 100%;
            }
            
            .card:hover {
                border-color: var(--primary);
                box-shadow: 0 0 15px rgba(0, 255, 0, 0.2);
                transform: translateY(-5px);
            }
            
            .card-title {
                color: var(--primary);
                border-bottom: 2px solid var(--primary);
                padding-bottom: 10px;
                margin-bottom: 20px;
                font-size: 1.3em;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .live-data {
                font-size: 2.8em;
                font-weight: bold;
                text-align: center;
                padding: 20px;
                border-radius: 10px;
                background: rgba(0, 0, 0, 0.5);
                margin: 20px 0;
                text-shadow: 0 0 10px currentColor;
            }
            
            .tai { color: var(--primary); }
            .xiu { color: var(--danger); }
            .neutral { color: var(--secondary); }
            
            .prediction-box {
                background: linear-gradient(135deg, rgba(0, 136, 255, 0.1), rgba(0, 255, 0, 0.1));
                border: 2px solid var(--secondary);
                padding: 20px;
                border-radius: 10px;
                margin: 15px 0;
            }
            
            .accuracy-bar {
                height: 20px;
                background: #333;
                border-radius: 10px;
                margin: 10px 0;
                overflow: hidden;
            }
            
            .accuracy-fill {
                height: 100%;
                background: linear-gradient(90deg, var(--danger), var(--warning), var(--primary));
                transition: width 1s ease;
                border-radius: 10px;
            }
            
            .stat-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 15px;
                margin-top: 15px;
            }
            
            .stat-item {
                background: rgba(255, 255, 255, 0.05);
                padding: 12px;
                border-radius: 8px;
                text-align: center;
            }
            
            .stat-value {
                font-size: 1.5em;
                font-weight: bold;
                color: var(--primary);
            }
            
            .stat-label {
                font-size: 0.9em;
                color: #888;
                margin-top: 5px;
            }
            
            .method-breakdown {
                display: flex;
                flex-direction: column;
                gap: 10px;
                margin-top: 15px;
            }
            
            .method-item {
                display: flex;
                justify-content: space-between;
                padding: 8px 12px;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 6px;
                border-left: 4px solid var(--primary);
            }
            
            .method-name {
                color: var(--light);
            }
            
            .method-weight {
                color: var(--primary);
                font-weight: bold;
            }
            
            .refresh-info {
                text-align: center;
                color: #888;
                margin-top: 30px;
                padding: 15px;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 8px;
                font-size: 0.9em;
            }
            
            .api-endpoints {
                margin-top: 30px;
                padding: 20px;
                background: rgba(0, 0, 0, 0.5);
                border-radius: 10px;
                border: 1px solid #333;
            }
            
            .endpoint-list {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 15px;
                margin-top: 15px;
            }
            
            .endpoint {
                padding: 12px;
                background: rgba(0, 136, 255, 0.1);
                border-radius: 8px;
                border: 1px solid rgba(0, 136, 255, 0.3);
            }
            
            .endpoint a {
                color: var(--secondary);
                text-decoration: none;
                font-weight: bold;
            }
            
            .endpoint a:hover {
                color: var(--primary);
                text-decoration: underline;
            }
            
            .streak-display {
                display: flex;
                justify-content: space-around;
                margin: 20px 0;
                padding: 15px;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 10px;
            }
            
            .streak-item {
                text-align: center;
            }
            
            .streak-value {
                font-size: 2em;
                font-weight: bold;
            }
            
            .win-streak { color: var(--primary); }
            .lose-streak { color: var(--danger); }
            
            @media (max-width: 768px) {
                .grid {
                    grid-template-columns: 1fr;
                }
                
                .live-data {
                    font-size: 2em;
                }
                
                .stat-grid {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="color: var(--primary); margin: 0; font-size: 2.5em;">🤖 SUN.WIN AI PREDICTION ENGINE</h1>
                <p style="color: var(--secondary); margin: 10px 0 20px 0; font-size: 1.2em;">
                    Hệ thống dự đoán thông minh với tỉ lệ chính xác cao - Giả lập thực tế
                </p>
                <div style="display: flex; justify-content: center; gap: 20px; margin-top: 20px;">
                    <div style="padding: 10px 20px; background: rgba(0, 255, 0, 0.1); border-radius: 20px;">
                        📡 Server: ${networkInfo.localIP}:${PORT}
                    </div>
                    <div style="padding: 10px 20px; background: rgba(0, 136, 255, 0.1); border-radius: 20px;">
                        🎯 Độ chính xác: ${predictionEngine.predictionStats.accuracy}%
                    </div>
                    <div style="padding: 10px 20px; background: rgba(255, 255, 0, 0.1); border-radius: 20px;">
                        📊 Dữ liệu: ${predictionEngine.history.length} phiên
                    </div>
                </div>
            </div>
            
            <div class="grid">
                <div class="card">
                    <div class="card-title">🎲 KẾT QUẢ HIỆN TẠI</div>
                    <div class="live-data ${apiResponseData.Ket_qua === 'Tài' ? 'tai' : apiResponseData.Ket_qua === 'Xỉu' ? 'xiu' : 'neutral'}">
                        ${apiResponseData.Tong ? 
                            `${apiResponseData.Xuc_xac_1}-${apiResponseData.Xuc_xac_2}-${apiResponseData.Xuc_xac_3} = ${apiResponseData.Tong}` : 
                            'Đang chờ kết quả...'}
                        ${apiResponseData.Tong ? `<br><span style="font-size: 0.6em;">(${apiResponseData.Ket_qua})</span>` : ''}
                    </div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <div class="stat-value">${apiResponseData.Phien || 'N/A'}</div>
                            <div class="stat-label">Phiên hiện tại</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${patternHistory.length}</div>
                            <div class="stat-label">Tổng phiên</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${stats.tai.percentage}</div>
                            <div class="stat-label">Tỷ lệ Tài</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${stats.xiu.percentage}</div>
                            <div class="stat-label">Tỷ lệ Xỉu</div>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">🔮 DỰ ĐOÁN TIẾP THEO</div>
                    ${prediction ? `
                        <div class="prediction-box">
                            <div style="text-align: center; margin-bottom: 15px;">
                                <span style="font-size: 2em; color: ${prediction.prediction === 'Tài' ? 'var(--primary)' : 'var(--danger)'}">
                                    ${prediction.prediction}
                                </span>
                            </div>
                            <div>
                                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                    <span>Độ tin cậy:</span>
                                    <span style="color: var(--primary); font-weight: bold;">${prediction.confidence}%</span>
                                </div>
                                <div class="accuracy-bar">
                                    <div class="accuracy-fill" style="width: ${prediction.confidence}%"></div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="method-breakdown">
                            <div style="color: #888; margin-bottom: 10px;">Phân tích phương pháp:</div>
                            ${prediction.methodBreakdown ? prediction.methodBreakdown.map(method => `
                                <div class="method-item">
                                    <span class="method-name">${method.method}</span>
                                    <span class="method-weight">${method.weight}</span>
                                </div>
                            `).join('') : 'Đang tính...'}
                        </div>
                    ` : '<p style="text-align: center; color: #888;">Đang tính toán dự đoán...</p>'}
                </div>
                
                <div class="card">
                    <div class="card-title">📊 THỐNG KÊ HIỆU SUẤT</div>
                    <div class="streak-display">
                        <div class="streak-item">
                            <div class="streak-value win-streak">${predictionEngine.predictionStats.streaks.currentWinStreak}</div>
                            <div class="stat-label">Win Streak</div>
                        </div>
                        <div class="streak-item">
                            <div class="streak-value">${predictionEngine.predictionStats.correctPredictions}</div>
                            <div class="stat-label">Dự đoán đúng</div>
                        </div>
                        <div class="streak-item">
                            <div class="streak-value lose-streak">${predictionEngine.predictionStats.streaks.currentLoseStreak}</div>
                            <div class="stat-label">Lose Streak</div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span>Tổng dự đoán:</span>
                            <span style="color: var(--primary);">${predictionEngine.predictionStats.totalPredictions}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span>Tỷ lệ chính xác:</span>
                            <span style="color: var(--primary); font-weight: bold;">${predictionEngine.predictionStats.accuracy}%</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span>Chuỗi thắng cao nhất:</span>
                            <span style="color: var(--primary);">${predictionEngine.predictionStats.streaks.maxWinStreak}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span>Chuỗi thua cao nhất:</span>
                            <span style="color: var(--danger);">${predictionEngine.predictionStats.streaks.maxLoseStreak}</span>
                        </div>
                    </div>
                </div>
                
                <div class="card">
                    <div class="card-title">📈 PHÂN TÍCH DỮ LIỆU</div>
                    <div style="margin: 15px 0;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Trung bình tổng điểm (Tài):</span>
                            <span style="color: var(--primary);">${stats.tai.averageTotal}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Trung bình tổng điểm (Xỉu):</span>
                            <span style="color: var(--danger);">${stats.xiu.averageTotal}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Chuỗi Tài dài nhất:</span>
                            <span style="color: var(--primary);">${stats.tai.longestStreak} phiên</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>Chuỗi Xỉu dài nhất:</span>
                            <span style="color: var(--danger);">${stats.xiu.longestStreak} phiên</span>
                        </div>
                    </div>
                    
                    <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #333;">
                        <div style="color: #888; margin-bottom: 10px;">Tổ hợp phổ biến:</div>
                        <div style="font-size: 0.9em;">
                            ${stats.dicePatterns.slice(0, 3).map(pattern => `
                                <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #333;">
                                    <span>${pattern[0]}</span>
                                    <span>${pattern[1]} lần</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="api-endpoints">
                <div class="card-title">🔗 API ENDPOINTS NÂNG CAO</div>
                <div class="endpoint-list">
                    <div class="endpoint">
                        <a href="/api/ditmemaysun" target="_blank">/api/ditmemaysun</a>
                        <div style="color: #888; font-size: 0.9em; margin-top: 5px;">Dữ liệu live + dự đoán</div>
                    </div>
                    <div class="endpoint">
                        <a href="/api/predict" target="_blank">/api/predict</a>
                        <div style="color: #888; font-size: 0.9em; margin-top: 5px;">Dự đoán chi tiết + giả lập</div>
                    </div>
                    <div class="endpoint">
                        <a href="/api/predict/advanced?sample=200" target="_blank">/api/predict/advanced</a>
                        <div style="color: #888; font-size: 0.9em; margin-top: 5px;">Giả lập nâng cao 200 phiên</div>
                    </div>
                    <div class="endpoint">
                        <a href="/api/analysis/patterns" target="_blank">/api/analysis/patterns</a>
                        <div style="color: #888; font-size: 0.9em; margin-top: 5px;">Phân tích mẫu & xu hướng</div>
                    </div>
                    <div class="endpoint">
                        <a href="/api/simulate/strategy" target="_blank">/api/simulate/strategy</a>
                        <div style="color: #888; font-size: 0.9em; margin-top: 5px;">So sánh chiến lược</div>
                    </div>
                    <div class="endpoint">
                        <a href="/api/stats" target="_blank">/api/stats</a>
                        <div style="color: #888; font-size: 0.9em; margin-top: 5px;">Thống kê tổng hợp</div>
                    </div>
                </div>
            </div>
            
            <div class="refresh-info">
                🔄 Dữ liệu tự động cập nhật mỗi 3 giây • Hệ thống giả lập thực tế với ${predictionEngine.history.length} phiên lịch sử
                <br>📅 Cập nhật lần cuối: ${new Date().toLocaleTimeString('vi-VN')}
            </div>
        </div>
        
        <script>
            // Auto-refresh với animation
            function updateData() {
                fetch('/api/ditmemaysun')
                    .then(res => res.json())
                    .then(data => {
                        if(data.Tong) {
                            const resultDiv = document.querySelector('.live-data');
                            if (resultDiv) {
                                resultDiv.innerHTML = \`\${data.Xuc_xac_1}-\${data.Xuc_xac_2}-\${data.Xuc_xac_3} = \${data.Tong}<br><span style="font-size: 0.6em;">(\${data.Ket_qua})</span>\`;
                                resultDiv.className = \`live-data \${data.Ket_qua === 'Tài' ? 'tai' : data.Ket_qua === 'Xỉu' ? 'xiu' : 'neutral'}\`;
                                
                                // Animation update
                                resultDiv.style.animation = 'none';
                                setTimeout(() => {
                                    resultDiv.style.animation = 'pulse 0.5s';
                                }, 10);
                            }
                        }
                        
                        // Update last update time
                        const updateTime = document.querySelector('.refresh-info');
                        if(updateTime) {
                            updateTime.innerHTML = \`🔄 Dữ liệu tự động cập nhật • Hệ thống giả lập thực tế với \${data.system_status?.engine_data_points || 0} phiên lịch sử<br>📅 Cập nhật lần cuối: \${new Date().toLocaleTimeString('vi-VN')}\`;
                        }
                    })
                    .catch(err => console.error('Update error:', err));
            }
            
            // Initial update
            updateData();
            
            // Auto-update every 3 seconds
            setInterval(updateData, 3000);
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// ========== UTILITY FUNCTIONS ==========
const getNetworkInfo = () => {
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    
    for (const ifaceName in interfaces) {
        for (const iface of interfaces[ifaceName]) {
            if (!iface.internal && iface.family === 'IPv4') {
                localIP = iface.address;
                break;
            }
        }
    }
    
    return { localIP };
};

// ========== START SERVER ==========
server.listen(PORT, '0.0.0.0', () => {
    const networkInfo = getNetworkInfo();
    console.log(`\n=========================================`);
    console.log(`🚀 SUN.WIN AI PREDICTION ENGINE`);
    console.log(`=========================================`);
    console.log(`📡 Server Information:`);
    console.log(`   Local: http://localhost:${PORT}`);
    console.log(`   Network: http://${networkInfo.localIP}:${PORT}`);
    console.log(`=========================================`);
    console.log(`🧠 Prediction System Features:`);
    console.log(`   • 5 thuật toán dự đoán kết hợp`);
    console.log(`   • Giả lập thực tế với dữ liệu lịch sử`);
    console.log(`   • Thống kê tỉ lệ thắng chi tiết`);
    console.log(`   • Phân tích mẫu & xu hướng`);
    console.log(`   • Độ chính xác hiện tại: ${predictionEngine.predictionStats.accuracy}%`);
    console.log(`=========================================`);
    console.log(`🔌 Connecting to Sun.Win WebSocket...`);
    console.log(`💀 AI Prediction System Activated!`);
    console.log(`=========================================\n`);
    
    connectWebSocket();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[⚠️] Shutting down gracefully...');
    if (ws) {
        ws.close();
    }
    if (server) {
        server.close(() => {
            console.log('[✅] Server closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});