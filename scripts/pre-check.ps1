# 定义函数
function Test-CommandInstalled([string]$CommandName) {
    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $true
    }
    else {
        return $false
    }
}

$location = Get-Location

# 检测Node命令是否存在
if (!(Test-CommandInstalled node)) {
    Write-Host "未检测到nodejs环境，尝试使用winget安装..."
    # 检测winget是否存在
    if (!(Test-CommandInstalled winget)) {
        Write-Host "未检测到 winget，无法完成安装，请检测系统版本，或尝试安装 winget:https://www.microsoft.com/p/app-installer/9nblggh4nns1#activetab=pivot:overviewtab"
    }
    else {
        winget install OpenJS.Nodejs --silent
        Write-Host "nodejs 安装完成，版本为："
        node --version
    }
}else{
    Write-Host "检测到 nodejs 环境，版本为："
    node --version
}

# 检测Git命令是否存在
if (!(Test-CommandInstalled git)) {
    Write-Host "未检测到 git 环境，尝试使用winget安装..."
    # 检测winget是否存在
    if (!(Test-CommandInstalled winget)) {
        Write-Host "未检测到 winget，无法完成安装，请检测系统版本，或尝试安装 winget:https://www.microsoft.com/p/app-installer/9nblggh4nns1#activetab=pivot:overviewtab"
    }
    else {
        winget install --id Git.Git -e --source winget
        Write-Host "git 安装完成，版本为："
        git --version
    }
}else{
    Write-Host "检测到 git 环境，版本为："
    git --version
}

# 检测 Node / npm 是否满足 engines（node >=18 <23、npm >=9）
# v9.16（dsh，M4-002）：不再检测/自动安装 yarn —— 仓库已统一到 npm + package-lock.json。
if (!(Test-CommandInstalled node)) {
    Write-Host "未检测到 Node.js，请手动安装 Node 18/20/22 LTS (https://nodejs.org/en/download)"
}else{
    $nodeVersion = (node -v).TrimStart('v')
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 18 -or $nodeMajor -ge 23) {
        Write-Host "Node 版本不满足要求：当前 $nodeVersion，需要 18 ~ 22（见 package.json 的 engines）"
    }else{
        Write-Host "检测到 Node 环境，版本为：$nodeVersion"
    }
}

if (!(Test-CommandInstalled npm)) {
    Write-Host "未检测到 npm，请重新安装 Node.js（npm 随 Node 一起安装）"
}else{
    $npmVersion = (npm -v).Trim()
    $npmMajor = [int]($npmVersion.Split('.')[0])
    if ($npmMajor -lt 9) {
        Write-Host "npm 版本过低：当前 $npmVersion，需要 >=9（可执行 npm install -g npm@10）"
    }else{
        Write-Host "检测到 npm 环境，版本为：$npmVersion"
    }
}