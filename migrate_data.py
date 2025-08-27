#!/usr/bin/env python3
"""
数据迁移脚本：将现有任务归属到 chenzhan 账户
"""
import json
import os
from pathlib import Path

def migrate_tasks():
    """将所有现有任务添加 username 字段"""
    
    # 文件路径
    base_path = Path(__file__).parent
    tasks_file = base_path / "data" / "tasks.json"
    completed_file = base_path / "data" / "completed_tasks.json"
    
    # 处理活动任务
    if tasks_file.exists():
        print(f"正在处理活动任务文件: {tasks_file}")
        with open(tasks_file, 'r', encoding='utf-8') as f:
            tasks = json.load(f)
        
        # 为每个任务添加 username
        for task_id, task in tasks.items():
            if 'username' not in task:
                task['username'] = 'chenzhan'
                print(f"  ✓ 任务 {task_id}: {task.get('title', '未命名')} - 已归属到 chenzhan")
        
        # 保存更新后的数据
        with open(tasks_file, 'w', encoding='utf-8') as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)
        print(f"✅ 已更新 {len(tasks)} 个活动任务")
    
    # 处理已完成任务
    if completed_file.exists():
        print(f"\n正在处理已完成任务文件: {completed_file}")
        with open(completed_file, 'r', encoding='utf-8') as f:
            completed = json.load(f)
        
        # 为每个任务添加 username
        for task_id, task in completed.items():
            if 'username' not in task:
                task['username'] = 'chenzhan'
                print(f"  ✓ 任务 {task_id}: {task.get('title', '未命名')} - 已归属到 chenzhan")
        
        # 保存更新后的数据
        with open(completed_file, 'w', encoding='utf-8') as f:
            json.dump(completed, f, ensure_ascii=False, indent=2)
        print(f"✅ 已更新 {len(completed)} 个已完成任务")

def create_user_database():
    """创建用户数据库文件"""
    
    base_path = Path(__file__).parent
    users_file = base_path / "data" / "users.json"
    
    # 创建默认用户
    users = {
        "chenzhan": {
            "password": "531020",
            "avatar": "😊",
            "created_at": "2025-08-27T00:00:00",
            "is_admin": True
        }
    }
    
    # 确保data目录存在
    users_file.parent.mkdir(exist_ok=True)
    
    # 保存用户数据
    with open(users_file, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    
    print(f"\n✅ 已创建用户数据库文件: {users_file}")
    print(f"  - 默认管理员账户: chenzhan / 531020")

if __name__ == "__main__":
    print("="*50)
    print("数据迁移脚本 - 将现有任务归属到 chenzhan 账户")
    print("="*50)
    
    try:
        migrate_tasks()
        create_user_database()
        print("\n🎉 数据迁移完成！")
        print("\n使用以下账户登录：")
        print("  用户名: chenzhan")
        print("  密码: 531020")
    except Exception as e:
        print(f"\n❌ 迁移失败: {e}")