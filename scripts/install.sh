cd `dirname $0`

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
# 有 package-lock.json 时用 npm ci（严格按锁安装，可复现）；锁文件缺失时退回 npm install
if [ -f package-lock.json ]; then
	npm ci --registry=https://registry.npmmirror.com || npm install --registry=https://registry.npmmirror.com
else
	npm install --registry=https://registry.npmmirror.com
fi
echo "依赖安装完成，启动程序..."

# 在浏览器中打开
open http://localhost:5173/

# 本地开启服务
npm run start

# 返回原始目录并退出
cd `dirname $0`
exit
