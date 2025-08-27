# 生活管理系统 v4.7

AI驱动的智能任务管理系统，帮助您高效管理生活的四大领域。

## 🚀 在线体验
- 前端: [GitHub Pages](https://yourusername.github.io/life_management/)
- 后端: 部署到[Vercel](https://vercel.com)

## ✨ 核心特性
- 🤖 **AI智能分解**: 输入自然语言，AI自动分解为结构化任务
- 🎯 **四域管理**: 学术/收入/成长/生活全覆盖
- 🌓 **双主题**: 优雅的明暗主题切换
- 📊 **实时统计**: 直观的进度仪表板

## 🛠️ 技术栈
- **前端**: 原生HTML5/CSS3/JavaScript (零依赖)
- **后端**: FastAPI + Python 3.9+
- **AI**: DeepSeek API
- **部署**: GitHub Pages + Vercel

## 📦 部署指南

### 前端 (GitHub Pages)
1. Fork项目 → Settings → Pages
2. Source: Deploy from branch
3. Branch: main, Folder: /frontend
4. 访问: `https://[username].github.io/life_management/`

### 后端 (Vercel)
1. 导入项目到Vercel
2. 设置环境变量: `DEEPSEEK_API_KEY`
3. 部署完成后更新 `frontend/js/config.js` 中的API地址

## 💻 本地开发
```bash
# 安装依赖
pip install -r requirements.txt

# 启动后端
python main_simple.py

# 访问前端
open frontend/index.html
```

## 🔑 环境配置
创建 `.env` 文件：
```
DEEPSEEK_API_KEY=your_api_key
```

## 📝 License
MIT

---
Made with ❤️ v4.7 (2025)