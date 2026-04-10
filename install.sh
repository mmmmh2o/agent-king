#!/bin/bash
set -e

REPO="https://github.com/mmmmh2o/agent-king.git"
INSTALL_DIR="${1:-$HOME/agent-king}"

echo "═══════════════════════════════════════"
echo "  👑 Agent-king 安装脚本"
echo "═══════════════════════════════════════"

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo "❌ Node.js 未安装，正在安装..."
    if command -v apt &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt install -y nodejs
    elif command -v yum &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
        yum install -y nodejs
    else
        echo "请手动安装 Node.js >= 20"
        exit 1
    fi
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo "❌ Node.js 版本需要 >= 20，当前: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v)"

# 检查 git
if ! command -v git &>/dev/null; then
    echo "❌ git 未安装，正在安装..."
    if command -v apt &>/dev/null; then
        apt install -y git
    elif command -v yum &>/dev/null; then
        yum install -y git
    fi
fi

echo "✅ git $(git --version | awk '{print $3}')"

# 克隆或更新
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "📂 目录已存在，拉取最新代码..."
    cd "$INSTALL_DIR"
    git pull
else
    echo "📥 克隆仓库到 $INSTALL_DIR ..."
    git clone "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# 安装依赖
echo "📦 安装依赖..."
npm install --production

# 构建
echo "🔨 构建..."
npx tsc

# 创建配置文件（如果不存在）
if [ ! -f "agent-king.json" ]; then
    echo "⚙️  创建配置文件..."
    cat > agent-king.json << 'CONF'
{
  "llm": {
    "api_key": "",
    "base_url": "https://api.xiaomimimo.com/v1",
    "model": "mimo-v2-pro"
  },
  "worker": {
    "model": "mimo-v2-pro",
    "count": 3
  },
  "server": {
    "port": 3456
  }
}
CONF
    echo "⚠️  请编辑 agent-king.json 填入你的 API Key"
fi

# 创建 systemd 服务（可选）
read -p "是否创建 systemd 服务? [y/N] " CREATE_SERVICE
if [[ "$CREATE_SERVICE" =~ ^[Yy]$ ]]; then
    cat > /etc/systemd/system/agent-king.service << SVC
[Unit]
Description=Agent-king - AI 开发调度平台
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(which node) dist/index.js serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SVC
    systemctl daemon-reload
    systemctl enable agent-king
    echo "✅ systemd 服务已创建"
    echo "   启动: systemctl start agent-king"
    echo "   状态: systemctl status agent-king"
    echo "   日志: journalctl -u agent-king -f"
fi

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ 安装完成！"
echo "═══════════════════════════════════════"
echo ""
echo "  安装目录: $INSTALL_DIR"
echo "  配置文件: $INSTALL_DIR/agent-king.json"
echo ""
echo "  用法:"
echo "    cd $INSTALL_DIR"
echo "    node dist/index.js run \"你的想法\""
echo "    node dist/index.js serve          # 仅启动面板"
echo "    node dist/index.js resume         # 从断点继续"
echo ""
echo "  Web 面板: http://localhost:3456"
echo ""
