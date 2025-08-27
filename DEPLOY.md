# 部署指南

## 准备工作
1. 删除GitHub上的旧仓库：https://github.com/chenzhan4321/life-management-system
2. 删除Vercel上的旧项目

## 第一步：创建新的GitHub仓库
```bash
# 创建新仓库
gh repo create life-management --public --source=. --remote=origin --push

# 或手动创建后推送
git remote remove origin
git remote add origin https://github.com/chenzhan4321/life-management.git
git push -u origin main
```

## 第二步：部署前端到GitHub Pages
1. 进入仓库Settings → Pages
2. Source: Deploy from a branch
3. Branch: main, Folder: /frontend
4. 等待部署完成，访问：https://chenzhan4321.github.io/life-management/

## 第三步：部署后端到Vercel
1. 访问 https://vercel.com/new
2. 导入GitHub仓库：chenzhan4321/life-management
3. 配置环境变量：
   - DEEPSEEK_API_KEY = your_api_key_here
4. 部署设置已配置在 vercel.json
5. 点击Deploy

## 第四步：更新前端配置
部署完成后，更新 frontend/js/config.js 中的API地址：
```javascript
window.API_BASE_URL = 'https://your-vercel-app.vercel.app';
```

## 文件清单
- 前端文件：/frontend 目录
- 后端文件：main_simple.py + requirements.txt
- 数据文件：/data 目录（自动生成）
- 配置文件：.env.example, vercel.json

## 注意事项
- 确保删除旧的GitHub仓库和Vercel项目
- 环境变量必须在Vercel中设置，不要提交.env文件
- 前端会自动部署到GitHub Pages
- 后端会自动部署到Vercel