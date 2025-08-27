// 前端配置文件 - 支持多种部署模式
const API_CONFIG = {
    // 后端API服务器地址配置
    // 根据不同的部署环境自动选择
    baseURL: (() => {
        const hostname = window.location.hostname;
        
        // 本地开发环境
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:8000';
        }
        
        // GitHub Pages 部署 - 连接到 Vercel 后端
        if (hostname.includes('github.io')) {
            // 替换为你的 Vercel 后端地址
            // 部署后请更新为实际的Vercel URL
            return 'https://your-app-name.vercel.app';
        }
        
        // Railway 部署（如果还在使用）
        if (window.RAILWAY_API) {
            return 'https://api-production-70ed.up.railway.app';
        }
        
        // 默认使用相对路径（同源部署）
        return '';
    })(),
    
    // API密钥（如果需要的话）
    apiKey: '',
    
    // 是否启用调试模式
    debug: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    
    // CORS 模式
    corsMode: window.location.hostname.includes('github.io') ? 'cors' : 'same-origin'
};

// 导出配置
window.API_CONFIG = API_CONFIG;

// 在控制台显示当前配置（仅调试模式）
if (API_CONFIG.debug) {
    console.log('当前API配置:', {
        baseURL: API_CONFIG.baseURL,
        corsMode: API_CONFIG.corsMode,
        debug: API_CONFIG.debug
    });
}