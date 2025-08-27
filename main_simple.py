"""
生活管理系统 API v4.8 - 集成AI智能处理与持久化存储
"""
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from datetime import datetime, date
import os
import uuid
import httpx
import json
import asyncio
from pathlib import Path

# DeepSeek API 配置
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-caaa6d9b2c2b43e6a5cccca712c73fc9")
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"

# 创建 FastAPI 应用
app = FastAPI(
    title="生活管理系统 API v4.8",
    description="集成AI智能处理与持久化存储的任务管理系统",
    version="4.2.0"
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    """健康检查端点"""
    return JSONResponse({
        "status": "success",
        "message": "生活管理系统API正在运行",
        "version": "1.0.0",
        "environment": os.getenv("RAILWAY_ENVIRONMENT", "development")
    })

@app.get("/health")
async def health_check():
    """健康检查"""
    return JSONResponse({
        "status": "healthy",
        "railway_service": os.getenv("RAILWAY_SERVICE_NAME", "unknown"),
        "domain": os.getenv("RAILWAY_PUBLIC_DOMAIN", "localhost")
    })

# 数据存储路径
DATA_DIR = Path("data")
DATA_FILE = DATA_DIR / "tasks.json"
HISTORY_FILE = DATA_DIR / "completed_tasks.json"

# 确保数据目录存在
DATA_DIR.mkdir(exist_ok=True)

# 任务数据库（内存缓存）
tasks_db = {}
completed_history = {}  # 历史完成任务

# 数据持久化锁
save_lock = asyncio.Lock()

def load_tasks_from_file():
    """从JSON文件加载任务数据"""
    global tasks_db, completed_history
    
    # 加载当前任务
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                tasks_db = json.load(f)
                print(f"✅ 已从文件加载 {len(tasks_db)} 个任务")
        except Exception as e:
            print(f"⚠️ 加载任务数据失败: {e}")
            tasks_db = {}
    else:
        print("📝 创建新的任务数据文件")
        tasks_db = {}
        save_tasks_to_file()
    
    # 加载历史任务
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                completed_history = json.load(f)
                print(f"📚 已加载 {len(completed_history)} 个历史任务")
        except Exception as e:
            print(f"⚠️ 加载历史数据失败: {e}")
            completed_history = {}
    else:
        completed_history = {}

def save_tasks_to_file():
    """保存任务数据到JSON文件"""
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(tasks_db, f, ensure_ascii=False, indent=2)
        print(f"💾 已保存 {len(tasks_db)} 个任务到文件")
    except Exception as e:
        print(f"❌ 保存任务数据失败: {e}")

def save_history_to_file():
    """保存历史任务到JSON文件"""
    try:
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(completed_history, f, ensure_ascii=False, indent=2)
        print(f"📚 已保存 {len(completed_history)} 个历史任务")
    except Exception as e:
        print(f"❌ 保存历史数据失败: {e}")

async def save_tasks_async():
    """异步保存任务数据"""
    async with save_lock:
        await asyncio.get_event_loop().run_in_executor(None, save_tasks_to_file)

async def save_history_async():
    """异步保存历史数据"""
    async with save_lock:
        await asyncio.get_event_loop().run_in_executor(None, save_history_to_file)

# 启动时加载数据
load_tasks_from_file()

# 数据模型
class Task(BaseModel):
    title: str
    domain: str
    status: str = "pending"
    priority: int = 3
    estimated_minutes: int = 30
    username: Optional[str] = None
    
@app.get("/api/tasks")
async def get_tasks():
    """获取任务列表（按优先级排序）"""
    tasks_list = list(tasks_db.values())
    # 按优先级升序排序（优先级1最高，5最低）
    tasks_list.sort(key=lambda x: (x.get("priority", 3), x.get("created_at", "")))
    return JSONResponse({
        "tasks": tasks_list,
        "total": len(tasks_list),
        "message": "API端点正常工作"
    })

@app.post("/api/tasks")
async def create_task(task: Task):
    """创建新任务"""
    task_id = f"task_{uuid.uuid4().hex[:8]}"
    task_data = task.model_dump()
    task_data["id"] = task_id
    task_data["created_at"] = datetime.now().isoformat()
    # 添加用户名字段（如果提供）
    if hasattr(task, 'username') and task.username:
        task_data["username"] = task.username
    tasks_db[task_id] = task_data
    await save_tasks_async()  # 保存到文件
    return JSONResponse({"status": "success", "task": task_data})

@app.put("/api/tasks/{task_id}")
async def update_task(task_id: str, task_data: Dict[str, Any] = Body(...)):
    """更新任务 (PUT)"""
    if task_id not in tasks_db:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 更新任务
    tasks_db[task_id].update(task_data)
    
    # 如果任务标记为完成，移动到历史文件
    if task_data.get("status") == "completed":
        # 添加完成时间
        tasks_db[task_id]["completed_at"] = datetime.now().isoformat()
        # 检查是否是今天完成的
        completed_date = datetime.now().strftime("%Y-%m-%d")
        # 移动到历史记录
        completed_history[task_id] = tasks_db[task_id]
        completed_history[task_id]["completed_date"] = completed_date
        # 从当前任务中删除
        del tasks_db[task_id]
        # 保存历史文件
        await save_history_async()
    
    await save_tasks_async()  # 保存到文件
    
    # 返回任务（如果已完成，从历史中返回）
    task = completed_history.get(task_id) if task_id in completed_history else tasks_db.get(task_id)
    return JSONResponse({"status": "success", "task": task})

@app.patch("/api/tasks/{task_id}")
async def patch_task(task_id: str, task_data: Dict[str, Any] = Body(...)):
    """部分更新任务 (PATCH)"""
    if task_id not in tasks_db:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 更新任务
    tasks_db[task_id].update(task_data)
    
    # 如果任务标记为完成，移动到历史文件
    if task_data.get("status") == "completed":
        # 添加完成时间
        tasks_db[task_id]["completed_at"] = datetime.now().isoformat()
        # 检查是否是今天完成的
        completed_date = datetime.now().strftime("%Y-%m-%d")
        # 移动到历史记录
        completed_history[task_id] = tasks_db[task_id]
        completed_history[task_id]["completed_date"] = completed_date
        # 从当前任务中删除
        del tasks_db[task_id]
        # 保存历史文件
        await save_history_async()
    
    await save_tasks_async()  # 保存到文件
    
    # 返回任务（如果已完成，从历史中返回）
    task = completed_history.get(task_id) if task_id in completed_history else tasks_db.get(task_id)
    return JSONResponse({"status": "success", "task": task})

@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    """删除任务（包括已归档的任务）"""
    # 先尝试从活动任务中删除
    if task_id in tasks_db:
        del tasks_db[task_id]
        await save_tasks_async()  # 保存到文件
        return JSONResponse({"success": True, "message": "任务已删除"})
    
    # 如果不在活动任务中，尝试从归档任务中删除
    if task_id in completed_history:
        del completed_history[task_id]
        await save_completed_tasks()  # 保存归档文件
        return JSONResponse({"success": True, "message": "已归档任务已删除"})
    
    # 如果都不存在，返回404
    raise HTTPException(status_code=404, detail="任务不存在")

@app.get("/api/analytics/daily")
async def get_daily_analytics():
    """获取每日统计数据"""
    today = datetime.now().strftime("%Y-%m-%d")
    # 计算今日完成的任务
    today_completed = [t for t in completed_history.values() 
                      if t.get("completed_date") == today]
    
    pending = len([t for t in tasks_db.values() if t.get("status") == "pending"])
    total = len(tasks_db) + len(today_completed)
    productivity_score = int((len(today_completed) / total * 100) if total > 0 else 0)
    
    return JSONResponse({
        "summary": {
            "completed_tasks": len(today_completed),
            "pending_tasks": pending,
            "total_tasks": total,
            "productivity_score": productivity_score,
            "date": today
        }
    })

@app.get("/api/tasks/completed/today")
async def get_today_completed_tasks():
    """获取今日完成的任务"""
    today = datetime.now().strftime("%Y-%m-%d")
    today_tasks = [task for task in completed_history.values() 
                   if task.get("completed_date") == today]
    
    # 按完成时间排序（最新的在前）
    today_tasks.sort(key=lambda x: x.get("completed_at", ""), reverse=True)
    
    return JSONResponse({
        "tasks": today_tasks,
        "total": len(today_tasks),
        "date": today
    })

@app.options("/api/tasks/{task_id}/uncomplete")
async def uncomplete_task_options(task_id: str):
    """处理uncomplete端点的OPTIONS预检请求"""
    return JSONResponse(
        content={},
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
    )

@app.post("/api/tasks/{task_id}/uncomplete")
async def uncomplete_task(task_id: str):
    """将已完成的任务恢复为未完成状态"""
    # 先检查任务是否在已完成历史中
    if task_id in completed_history:
        task = completed_history[task_id].copy()
        # 恢复任务到活动任务列表
        task["status"] = "pending"
        task["completed_at"] = None
        task.pop("completed_date", None)  # 移除完成日期
        
        # 添加回活动任务
        tasks_db[task_id] = task
        
        # 从历史中删除
        del completed_history[task_id]
        
        # 保存数据
        await save_tasks()
        await save_completed_history()
        
        return JSONResponse(
            content={
                "success": True,
                "message": "任务已恢复到未完成状态",
                "task": task
            },
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        )
    else:
        # 如果不在历史中，可能在活动任务中，直接更新状态
        if task_id in tasks_db:
            tasks_db[task_id]["status"] = "pending"
            tasks_db[task_id]["completed_at"] = None
            await save_tasks()
            return JSONResponse(
                content={
                    "success": True,
                    "message": "任务已更新为未完成状态",
                    "task": tasks_db[task_id]
                },
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type"
                }
            )
        else:
            return JSONResponse(
                content={
                    "success": False,
                    "message": "任务未找到"
                },
                status_code=404,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type"
                }
            )

# AI处理相关数据模型
class AIProcessRequest(BaseModel):
    text: str
    mode: str = "smart"  # smart, optimize, learn

@app.post("/api/ai/process")
async def process_with_ai(request: AIProcessRequest):
    """使用DeepSeek AI处理文本，分析并结构化任务"""
    try:
        # 将输入文本按行分割，每行作为独立任务
        lines = [line.strip() for line in request.text.strip().split('\n') if line.strip()]
        
        # 如果没有有效内容
        if not lines:
            return JSONResponse({
                "status": "success",
                "created_tasks": [],
                "summary": "没有找到有效任务",
                "total": 0
            })
        
        # 获取历史任务作为参考（最近20个）
        recent_tasks = []
        for task_id, task in list(tasks_db.items())[-20:]:
            recent_tasks.append({
                "title": task.get("title", "")[:30],  # 截取前30字符
                "domain": task.get("domain", "life"),
                "priority": task.get("priority", 3),
                "estimated_minutes": task.get("estimated_minutes", 30)
            })
        
        # 构建历史参考文本
        history_text = ""
        if recent_tasks:
            history_text = "\n历史任务参考（用于学习分类模式）：\n"
            for t in recent_tasks[-5:]:  # 只取最近5个作为示例
                history_text += f"- {t['title']} -> 领域:{t['domain']}, 优先级:{t['priority']}, 时间:{t['estimated_minutes']}分钟\n"
        
        # 构建提示词 - 强化分类准确性
        system_prompt = f"""你是一个专业的任务分析助手。请严格按照以下规则分析每个任务：

**核心要求**：
1. 每一行都是独立任务，必须分别分析
2. 仔细识别任务内容，根据关键词准确分类
3. 如果任务中包含时间标记(如10m、30m、60m)，使用该时间作为estimated_minutes

**领域分类（必须准确判断）**：

1. academic（学术相关）- 以下情况归为此类：
   - 算法相关：strassen、mamba、神经网络、机器学习等
   - 编程开发：代码、程序、系统、软件等
   - 学术研究：论文、研究、实验、文献等
   - 课程学习：课程、作业、学习某个技术概念等
   示例：strassen算法、ocr typo detection、学习Kyle的文件

2. income（财务相关）- 以下情况归为此类：
   - 报销事务：票据、报销、出差费用等
   - 工资薪酬：发工资、劳务费、薪资等
   - 银行事务：银行卡、信用卡、转账等
   - 财务管理：预算、费用、收支等
   示例：整理出差票据、发劳务费、银行卡事务

3. growth（个人成长）- 以下情况归为此类：
   - 新技术探索：试一试、了解、探索新工具
   - 技能提升：学习新方法、提升能力
   - 个人发展：自我提升类任务
   示例：试一试mamba、学习新框架

4. life（日常生活）- 以下情况归为此类：
   - 邮件回复：回信、邮件、联系某人
   - 日常事务：买药、生活琐事
   - 人际交往：给某人东西、社交活动
   示例：回信、失眠药给领导、爱欲课

**优先级规则**：
- 1级：包含"紧急"、"马上"、"立即"、"今天必须"
- 2级：包含"重要"、工作核心任务、教授/领导相关
- 3级：一般任务（默认）
- 4级：包含"试试"、"看看"、"了解"等探索性词
- 5级：可延后的休闲任务

**时间估算规则**：
- 优先识别任务中的时间标记（10m=10分钟，30m=30分钟，60m=60分钟）
- 无标记时根据任务类型估算：
  - 简单回信：20-30分钟
  - 算法编程：60-120分钟
  - 整理文档：45-60分钟
  - 学习研究：60-90分钟

{history_text}

**输出格式**（必须返回JSON格式）：
返回一个符合以下结构的JSON对象：
{{
  "tasks": [
    {{"title": "保持原文不变", "domain": "必须是academic/income/growth/life之一", "priority": 1-5的数字, "estimated_minutes": 实际分钟数}}
  ],
  "summary": "分析完成，共X个任务"
}}

请认真分析每个任务的内容并返回JSON格式，不要全部归为默认值！"""
        
        # 将所有行用换行符连接，明确告诉AI每行是独立任务
        task_list_text = "\n".join([f"{i+1}. {line}" for i, line in enumerate(lines)])
        user_prompt = f"请分析以下{len(lines)}个独立任务，每个编号对应一个任务：\n{task_list_text}"
        
        # 调用DeepSeek API
        async with httpx.AsyncClient() as client:
            response = await client.post(
                DEEPSEEK_API_URL,
                headers={
                    "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.3,  # 降低温度提高准确性
                    "max_tokens": 2000,  # 增加token避免截断
                    "response_format": {"type": "json_object"}  # 强制JSON格式
                },
                timeout=60.0  # 增加到60秒避免超时
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="AI服务暂时不可用")
            
            result = response.json()
            ai_response = result.get("choices", [{}])[0].get("message", {}).get("content", "{}")
            
            # 解析AI返回的JSON
            try:
                parsed_tasks = json.loads(ai_response)
                
                # 验证返回的任务数量是否正确
                if len(parsed_tasks.get("tasks", [])) != len(lines):
                    print(f"警告：AI返回了{len(parsed_tasks.get('tasks', []))}个任务，但输入有{len(lines)}行")
                    # 如果数量不匹配，为缺失的行创建默认任务
                    ai_tasks = parsed_tasks.get("tasks", [])
                    for i in range(len(lines)):
                        if i >= len(ai_tasks):
                            ai_tasks.append({
                                "title": lines[i],
                                "domain": "life",
                                "priority": 3,
                                "estimated_minutes": 30
                            })
                    parsed_tasks["tasks"] = ai_tasks[:len(lines)]  # 确保不超过输入行数
                    
            except json.JSONDecodeError:
                # 如果AI返回的不是有效JSON，为每行创建默认任务
                print("警告：AI返回的不是有效JSON，使用默认值")
                parsed_tasks = {
                    "tasks": [
                        {
                            "title": line,
                            "domain": "life",
                            "priority": 3,
                            "estimated_minutes": 30
                        } for line in lines
                    ],
                    "summary": f"已创建{len(lines)}个任务"
                }
            
            # 将AI生成的任务添加到数据库
            created_tasks = []
            for task_data in parsed_tasks.get("tasks", []):
                task_id = f"task_{uuid.uuid4().hex[:8]}"
                task = {
                    "id": task_id,
                    "title": task_data.get("title", "未命名任务"),
                    "domain": task_data.get("domain", "life"),
                    "priority": task_data.get("priority", 3),
                    "estimated_minutes": task_data.get("estimated_minutes", 30),
                    "status": "pool",  # AI处理的任务放入任务池
                    "created_at": datetime.now().isoformat()
                }
                tasks_db[task_id] = task
                created_tasks.append(task)
            
            # 保存到文件
            await save_tasks_async()
            
            return JSONResponse({
                "status": "success",
                "created_tasks": created_tasks,
                "summary": parsed_tasks.get("summary", "任务已创建"),
                "total": len(created_tasks)
            })
            
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AI处理超时，请稍后重试")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"处理失败: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)