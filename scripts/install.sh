set -euo pipefail
cd "$(dirname "$0")"

# 判断是否安装了 Node
if ! type node >/dev/null 2>&1; then
	echo "未检测到nodejs环境，尝试使用homebrew安装..."
	# 检测homebrew是否存在
	if ! type brew >/dev/null 2>&1; then
		echo "未检测到homebrew，无法完成安装，请安装homebrew或直接安装nodejs"
	else
		brew install node
	fi
fi

cd ..
echo "开始安装依赖..."
# 只允许 npm ci：锁文件与 package.json 不一致时应当报错，而不是悄悄重写依赖树
if [ ! -f package-lock.json ]; then
	echo "缺少 package-lock.json，拒绝安装（请先在仓库根执行 npm install 并提交锁文件）"
	exit 1
fi
npm ci --registry=https://registry.npmmirror.com
echo "依赖安装完成，启动程序..."

# 启动开发服务器（默认 http://localhost:5173，由 Vite 打印实际地址）
npm run start

# 返回原始目录并退出
set -euo pipefail
cd "$(dirname "$0")"
exit
