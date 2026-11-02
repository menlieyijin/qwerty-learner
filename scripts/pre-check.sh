cd "$(dirname "$0")" || exit

# 判断是否安装了 Node
if ! type node >/dev/null 2>&1; then
	echo "未检测到 nodejs 环境，尝试使用homebrew安装..."
	# 检测homebrew是否存在
	if ! type brew >/dev/null 2>&1; then
		echo "未检测到 homebrew，无法完成安装，请安装 homebrew 后进行尝试 (https://brew.sh/)"
	else
		brew install node
        echo "node 安装完成，版本为: "
        node --version
	fi
else
    echo "检测到 NodeJS 环境，版本为："
    node -v
fi

if ! type git >/dev/null 2>&1; then
    echo "未检测到 git 环境，尝试使用 homebrew 安装..."
    # 检测 homebrew 是否存在
    if ! type brew >/dev/null 2>&1; then
        echo "未检测到 homebrew，请手动安装 homebrew 后进行尝试 (https://brew.sh/)"
    else 
        brew install git
        echo "git 安装完成，版本为: "
        git --version
    fi
else
    echo "检测到 git 环境，版本为："
    git --version
fi

# 检测 Node / npm 是否满足 engines（node >=22.12 <23、npm >=10）
# v9.16（dsh，M4-002）：不再检测/自动安装 yarn —— 仓库已统一到 npm + package-lock.json。
if ! type node >/dev/null 2>&1; then
    echo "未检测到 Node.js，请安装 Node 22 LTS（>=22.12） (https://nodejs.org/en/download)"
else
    node_version=$(node -v | tr -d 'v')
    node_major=${node_version%%.*}
    node_minor=$(echo "$node_version" | cut -d. -f2)
    if [ "$node_major" -lt 22 ] || [ "$node_major" -ge 23 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 12 ]; }; then
        echo "Node 版本不满足要求：当前 $node_version，需要 >=22.12 <23（见 package.json 的 engines）"
    else
        echo "检测到 Node 环境，版本为：$node_version"
    fi
fi

if ! type npm >/dev/null 2>&1; then
    echo "未检测到 npm，请重新安装 Node.js（npm 随 Node 一起安装）"
else
    npm_version=$(npm -v)
    npm_major=${npm_version%%.*}
    if [ "$npm_major" -lt 10 ]; then
        echo "npm 版本过低：当前 $npm_version，需要 >=10（可执行 npm install -g npm@10）"
    else
        echo "检测到 npm 环境，版本为：$npm_version"
    fi
fi